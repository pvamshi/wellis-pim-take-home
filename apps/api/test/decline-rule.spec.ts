import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import type { DeclineResponse } from '../src/decline/decline.controller';
import { LegacyPatientRule, type LegacyRuleStatus } from '../src/legacy/legacy-rule.entity';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * Declining a rule (1.2.6), over HTTP and against a real database.
 *
 * No rules and no registry anywhere in this suite: declining runs no rule. What
 * it writes is one `rule_version` row, so every assertion reads that table back
 * — the status, the review flag and the reason — rather than watching a service
 * be called, which could not tell a stored reason from a discarded one.
 *
 * The findings a declined rule leaves behind are seeded straight through the
 * rule-row repository, the same way `approve.spec.ts` seeds what a run left.
 *
 * Each test uses rule ids of its own, so no test's active version can be picked
 * up by another's press.
 */

/** A row of any table as the driver returns it, columns and all. */
type StoredRow = Record<string, unknown>;

/** One rule row, as a run would have left it. Pending unless said otherwise. */
interface FindingSeed {
  legacyId: string;
  ruleId: string;
  version?: number;
  column: string;
  previousValue?: string | null;
  nextValue?: string | null;
  status?: LegacyRuleStatus;
  reason?: string | null;
}

describe('declining a rule', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let rules: Repository<Rule>;
  let versions: Repository<RuleVersion>;
  let patientRules: Repository<LegacyPatientRule>;
  let ruleVersions: RuleVersionsService;

  /** A rule with its versions, and one of them active (1.1.8). */
  async function seedRule(
    ruleId: string,
    versionNumbers: number[],
    active?: number,
  ): Promise<void> {
    await rules.save({
      ruleId,
      ruleName: `${ruleId} name`,
      description: `${ruleId} description`,
      ambiguous: false,
    });

    for (const version of versionNumbers) {
      await versions.insert({ ruleId, version });
    }

    if (active !== undefined) {
      await ruleVersions.activate(ruleId, active);
    }
  }

  /** Rule rows a run would have written. */
  async function seedFindings(rows: FindingSeed[]): Promise<void> {
    await patientRules.insert(
      rows.map((row) => ({
        version: 1,
        previousValue: null,
        nextValue: null,
        status: 'pending' as LegacyRuleStatus,
        reason: null,
        ...row,
      })),
    );
  }

  /** The press itself. No body at all when none is handed in (1.2.6). */
  async function declineRule(
    ruleId: string,
    body?: unknown,
  ): Promise<{ status: number; body: DeclineResponse }> {
    const call = request(app.getHttpServer()).post(`/rules/${ruleId}/decline`);
    const response = body === undefined ? await call : await call.send(body as object);

    return { status: response.status, body: response.body as DeclineResponse };
  }

  /** One version row, or a failure naming the version that is not there. */
  async function versionOf(ruleId: string, version: number): Promise<RuleVersion> {
    return await versions.findOneOrFail({ where: { ruleId, version } });
  }

  /** Which versions of a rule are active — the invariant 1.1.8 states. */
  async function activeVersionsOf(ruleId: string): Promise<number[]> {
    const active = await versions.find({
      where: { ruleId, status: 'active' },
      order: { version: 'ASC' },
    });

    return active.map((row) => row.version);
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    // Booting is what creates the tables: `synchronize: true` and no migration
    // step to stand in for it (tech-stack 4.4).
    await app.init();
    dataSource = moduleRef.get(DataSource);
    rules = dataSource.getRepository(Rule);
    versions = dataSource.getRepository(RuleVersion);
    patientRules = dataSource.getRepository(LegacyPatientRule);
    ruleVersions = moduleRef.get(RuleVersionsService);
  });

  afterAll(async () => {
    await app.close();

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }

    database.cleanup();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM legacy_patient_rule`);
    await dataSource.query(`DELETE FROM legacy_intake_rule`);
    await dataSource.query(`DELETE FROM legacy_consent_rule`);
    await dataSource.query(`DELETE FROM rule_version`);
    await dataSource.query(`DELETE FROM rule`);
  });

  it('parks the active version and stores the reason it was given', async () => {
    await seedRule('R-REASON', [1], 1);

    const { status, body } = await declineRule('R-REASON', {
      reason: 'It matched Belgian numbers too',
    });

    // 200 rather than the 201 a POST defaults to: nothing was created at a URL.
    expect(status).toBe(200);
    expect(body).toEqual({
      ruleId: 'R-REASON',
      version: 1,
      reason: 'It matched Belgian numbers too',
    });

    // 1.2.6, first scenario, read straight off the row: inactive, in the
    // revision queue, with the reason stored on that version.
    const stored = await dataSource.query<StoredRow[]>(
      `SELECT * FROM rule_version WHERE rule_id = 'R-REASON'`,
    );

    expect(stored).toEqual([
      {
        rule_id: 'R-REASON',
        version: 1,
        status: 'inactive',
        needs_review: 1,
        reason: 'It matched Belgian numbers too',
      },
    ]);
    expect(await activeVersionsOf('R-REASON')).toEqual([]);
  });

  it('parks the active version with no reason when the press carries no body', async () => {
    await seedRule('R-SILENT', [1], 1);

    const { status, body } = await declineRule('R-SILENT');

    // 1.2.6, second scenario: the reason is optional, and a press without one
    // records nothing in its place rather than failing or inventing a reason.
    expect(status).toBe(200);
    expect(body).toEqual({ ruleId: 'R-SILENT', version: 1, reason: null });

    const parked = await versionOf('R-SILENT', 1);

    expect(parked.status).toBe('inactive');
    expect(parked.needsReview).toBe(true);
    expect(parked.reason).toBeNull();
  });

  it('treats an empty body and an empty reason as no reason at all', async () => {
    await seedRule('R-EMPTY-BODY', [1], 1);
    await seedRule('R-NULL-REASON', [1], 1);
    await seedRule('R-BLANK', [1], 1);

    const emptyBody = await declineRule('R-EMPTY-BODY', {});
    const nullReason = await declineRule('R-NULL-REASON', { reason: null });
    const blank = await declineRule('R-BLANK', { reason: '   ' });

    // All three are the same press. A reason of only whitespace is stored as
    // none: a row holding " " would read as feedback to the revision workflow
    // (1.5.1), and 1.2.6 says "no reason recorded".
    expect(emptyBody.body).toEqual({ ruleId: 'R-EMPTY-BODY', version: 1, reason: null });
    expect(nullReason.body).toEqual({ ruleId: 'R-NULL-REASON', version: 1, reason: null });
    expect(blank.body).toEqual({ ruleId: 'R-BLANK', version: 1, reason: null });

    for (const ruleId of ['R-EMPTY-BODY', 'R-NULL-REASON', 'R-BLANK']) {
      const parked = await versionOf(ruleId, 1);

      expect(parked.status).toBe('inactive');
      expect(parked.needsReview).toBe(true);
      expect(parked.reason).toBeNull();
    }
  });

  it('stores a reason that was padded, without the padding', async () => {
    await seedRule('R-PADDED', [1], 1);

    const { body } = await declineRule('R-PADDED', { reason: '  the city is not a typo  ' });

    expect(body.reason).toBe('the city is not a typo');
    expect((await versionOf('R-PADDED', 1)).reason).toBe('the city is not a typo');
  });

  it('deletes nothing: the rule and every version of it are still there', async () => {
    await seedRule('R-KEPT', [1, 2, 3], 3);

    await declineRule('R-KEPT', { reason: 'wrong on three rows out of four' });

    // 1.1.8: a rule is never deleted, it is made inactive. The rule row still
    // carries what a human reads about it...
    expect(await rules.findOneOrFail({ where: { ruleId: 'R-KEPT' } })).toEqual({
      ruleId: 'R-KEPT',
      ruleName: 'R-KEPT name',
      description: 'R-KEPT description',
      ambiguous: false,
    });

    // ...and every version row is still there, so the modification log keeps
    // pointing at the code that proposed each change already applied (1.3).
    const kept = await versions.find({ where: { ruleId: 'R-KEPT' }, order: { version: 'ASC' } });

    expect(kept.map((row) => row.version)).toEqual([1, 2, 3]);
    expect(kept.map((row) => row.status)).toEqual(['inactive', 'inactive', 'inactive']);
  });

  it('writes the active version only, leaving the rule’s history untouched', async () => {
    await seedRule('R-HISTORY', [1, 2], 2);

    const { body } = await declineRule('R-HISTORY', { reason: 'version 2 is the broken one' });

    // The press names the active version, not the rule (1.1.8). Version 1 was
    // superseded long ago and nobody declined it, so it must not be stamped
    // with this reason or pushed into the revision queue.
    expect(body).toEqual({
      ruleId: 'R-HISTORY',
      version: 2,
      reason: 'version 2 is the broken one',
    });

    const superseded = await versionOf('R-HISTORY', 1);

    expect(superseded.status).toBe('inactive');
    expect(superseded.needsReview).toBe(false);
    expect(superseded.reason).toBeNull();

    const declined = await versionOf('R-HISTORY', 2);

    expect(declined.status).toBe('inactive');
    expect(declined.needsReview).toBe(true);
    expect(declined.reason).toBe('version 2 is the broken one');
  });

  it('leaves another rule’s active version active', async () => {
    await seedRule('R-LEFT', [1], 1);
    await seedRule('R-RIGHT', [1], 1);

    await declineRule('R-LEFT', { reason: 'only this one is wrong' });

    // "Exactly one version of a rule is active" is a per-rule fact (1.1.8), so
    // one decline must not park the whole screen (1.2.1).
    expect(await activeVersionsOf('R-LEFT')).toEqual([]);
    expect(await activeVersionsOf('R-RIGHT')).toEqual([1]);

    const untouched = await versionOf('R-RIGHT', 1);

    expect(untouched.needsReview).toBe(false);
    expect(untouched.reason).toBeNull();
  });

  it('decides none of the rule’s rows, which stay pending for the new version', async () => {
    await seedRule('R-ROWS', [1], 1);
    await seedFindings([
      {
        legacyId: 'P-1',
        ruleId: 'R-ROWS',
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
      },
      {
        legacyId: 'P-2',
        ruleId: 'R-ROWS',
        column: 'phone',
        previousValue: '0698765432',
        nextValue: '+31698765432',
        status: 'declined',
        reason: 'that number is the practice',
      },
    ]);

    await declineRule('R-ROWS', { reason: 'the whole rule is wrong' });

    // 1.2.6 speaks only of the version. The rule leaves the screen because the
    // screen filters to active versions (1.2.1), not because its findings were
    // decided — deciding a row is the row-level cross's job (1.2.7). So the
    // pending row is still pending, with both values intact, and the reason on
    // the already-declined row is the row's own, not the rule's.
    const rows = await patientRules.find({ order: { legacyId: 'ASC' } });

    expect(rows).toEqual([
      {
        legacyId: 'P-1',
        ruleId: 'R-ROWS',
        version: 1,
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
        status: 'pending',
        reason: null,
      },
      {
        legacyId: 'P-2',
        ruleId: 'R-ROWS',
        version: 1,
        column: 'phone',
        previousValue: '0698765432',
        nextValue: '+31698765432',
        status: 'declined',
        reason: 'that number is the practice',
      },
    ]);
    expect(await activeVersionsOf('R-ROWS')).toEqual([]);
  });

  it('writes nothing on a second press, or on a rule id nobody has written', async () => {
    await seedRule('R-TWICE', [1], 1);
    await declineRule('R-TWICE', { reason: 'the first reason' });

    const second = await declineRule('R-TWICE', { reason: 'the second reason' });
    const missing = await declineRule('R-NOWHERE', { reason: 'a rule that is not there' });

    // Neither press has an active version to act on — the first is already
    // declined and waiting on the revision workflow (1.5.1), the second is a
    // rule id nobody has written. Both are a count rather than a fault, for an
    // operator pressing from a screen that may be a moment stale (1.2.12).
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ruleId: 'R-TWICE', version: null, reason: null });
    expect(missing.status).toBe(200);
    expect(missing.body).toEqual({ ruleId: 'R-NOWHERE', version: null, reason: null });

    // And the second press is inert: the version keeps the reason the decline
    // that actually happened gave it.
    const declined = await versionOf('R-TWICE', 1);

    expect(declined.status).toBe('inactive');
    expect(declined.needsReview).toBe(true);
    expect(declined.reason).toBe('the first reason');
    expect(await versions.count({ where: { ruleId: 'R-NOWHERE' } })).toBe(0);
  });

  it('declines nothing when the reason is not a string', async () => {
    await seedRule('R-MALFORMED', [1], 1);

    const numeric = await declineRule('R-MALFORMED', { reason: 7 });
    const nested = await declineRule('R-MALFORMED', { reason: { why: 'because' } });
    const listed = await declineRule('R-MALFORMED', ['because']);

    // A malformed request is the caller's mistake and nothing else, so it is a
    // 400 — and it declines nothing, rather than parking the rule with a
    // coerced reason the revision workflow would later read as feedback.
    expect(numeric.status).toBe(400);
    expect(nested.status).toBe(400);
    expect(listed.status).toBe(400);

    const untouched = await versionOf('R-MALFORMED', 1);

    expect(untouched.status).toBe('active');
    expect(untouched.needsReview).toBe(false);
    expect(untouched.reason).toBeNull();
    expect(await activeVersionsOf('R-MALFORMED')).toEqual([1]);
  });
});
