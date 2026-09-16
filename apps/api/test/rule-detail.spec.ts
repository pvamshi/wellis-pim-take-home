import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import {
  LegacyConsentRule,
  LegacyIntakeRule,
  LegacyPatientRule,
  type LegacyRuleRow,
  type LegacyRuleStatus,
} from '../src/legacy/legacy-rule.entity';
import type { RuleDetailResponse } from '../src/rule-detail/rule-detail.controller';
import type { RuleDetailVersionGroup } from '../src/rules/rule-detail.service';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * One expanded rule (1.2.2, 1.2.3, 1.1.12), over HTTP and against a real
 * database.
 *
 * No rules and no registry anywhere in this suite: expanding a rule runs no
 * rule. What the screen reads is what a run left behind, so every fixture is
 * seeded straight through the repositories, exactly as `rules-list.spec.ts`
 * and `approve.spec.ts` do.
 *
 * Nothing here asserts that a service was called. Every assertion is about the
 * body the endpoint answered with, because the blocks and their sections *are*
 * the behaviour: a suite watching a call could not tell a row that was shown
 * from one that was silently dropped.
 *
 * Each test uses rule ids and legacy ids of its own, so no test's rows can
 * appear in another's detail.
 */

/** One rule row, as a run would have left it. Pending unless said otherwise. */
interface FindingSeed {
  legacyId: string;
  ruleId: string;
  version?: number;
  column?: string;
  previousValue?: string | null;
  nextValue?: string | null;
  status?: LegacyRuleStatus;
}

/** A row as the detail returns it, with `nextValue` present or absent. */
interface DetailRowBody {
  table: string;
  legacyId: string;
  column: string;
  previousValue: string | null;
  nextValue?: string | null;
}

describe('the rule detail', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let rules: Repository<Rule>;
  let versions: Repository<RuleVersion>;
  let patientRules: Repository<LegacyPatientRule>;
  let intakeRules: Repository<LegacyIntakeRule>;
  let consentRules: Repository<LegacyConsentRule>;
  let ruleVersions: RuleVersionsService;

  /** A rule with its versions, and one of them active (1.1.8). */
  async function seedRule(
    ruleId: string,
    versionNumbers: number[],
    active?: number,
    options: { ambiguous?: boolean; description?: string } = {},
  ): Promise<void> {
    await rules.save({
      ruleId,
      ruleName: `${ruleId} name`,
      description: options.description ?? `${ruleId} description`,
      ambiguous: options.ambiguous ?? false,
    });

    for (const version of versionNumbers) {
      await versions.insert({ ruleId, version });
    }

    if (active !== undefined) {
      await ruleVersions.activate(ruleId, active);
    }
  }

  /** Rule rows a run would have written. */
  async function seedFindings(
    repository: Repository<LegacyRuleRow>,
    rows: FindingSeed[],
  ): Promise<void> {
    const complete = rows.map((row) => ({
      version: 1,
      column: 'phone',
      previousValue: '0612345678',
      nextValue: '+31612345678',
      status: 'pending' as LegacyRuleStatus,
      reason: null,
      ...row,
    }));

    for (let start = 0; start < complete.length; start += 50) {
      await repository.insert(complete.slice(start, start + 50));
    }
  }

  /**
   * `count` rule rows for one rule and version, each against a legacy row of
   * its own — the primary key is `(legacyId, ruleId, version, column)`, so rows
   * sharing a legacy id and a column would be one row overwritten, not many.
   */
  function findings(
    ruleId: string,
    count: number,
    options: { version?: number; status?: LegacyRuleStatus; prefix?: string } = {},
  ): FindingSeed[] {
    return Array.from({ length: count }, (_, index) => ({
      legacyId: `${options.prefix ?? ruleId}-${index + 1}`,
      ruleId,
      version: options.version ?? 1,
      status: options.status ?? 'pending',
    }));
  }

  /** Expanding one rule (1.2.2). */
  async function loadDetail(ruleId: string): Promise<{ status: number; body: RuleDetailResponse }> {
    const response = await request(app.getHttpServer()).get(`/rules/${ruleId}`);

    return { status: response.status, body: response.body as RuleDetailResponse };
  }

  /**
   * The one block a fixture with a single version leaves behind.
   *
   * It throws rather than returning the first of several, so a test that means
   * "one version made all of these" cannot quietly pass while reading one block
   * of two.
   */
  function soleGroup(body: RuleDetailResponse): RuleDetailVersionGroup {
    if (body.versions.length !== 1) {
      throw new Error(
        `expected one version block, got ${body.versions.length}: ${body.versions
          .map((group) => `v${group.version}`)
          .join(', ')}`,
      );
    }

    return body.versions[0];
  }

  /** Every row of the detail, whichever block and section it is in. */
  function allRows(body: RuleDetailResponse): DetailRowBody[] {
    return body.versions.flatMap((group) => [...group.pending, ...group.approved]);
  }

  /** `(table, legacyId, column)` of every row of a section, in its order. */
  function addresses(rows: readonly DetailRowBody[]): string[] {
    return rows.map((row) => `${row.table}/${row.legacyId}/${row.column}`);
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
    intakeRules = dataSource.getRepository(LegacyIntakeRule);
    consentRules = dataSource.getRepository(LegacyConsentRule);
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

  it('lists the pending rows and the approved rows as two sections', async () => {
    await seedRule('R-TWO', [1], 1);
    await seedFindings(patientRules, findings('R-TWO', 12, { prefix: 'WAITING' }));
    await seedFindings(
      patientRules,
      findings('R-TWO', 328, { prefix: 'DONE', status: 'approved' }),
    );

    const { status, body } = await loadDetail('R-TWO');
    const group = soleGroup(body);

    // 1.2.2: "a pending section lists the 12 rows awaiting a decision / and an
    // approved section lists the 328 already applied." Exactly those rows, not
    // 340 in one heap and not the same rows in both. One version made them all,
    // so they are one block.
    expect(status).toBe(200);
    expect(body.version).toBe(1);
    expect([group.version, group.state]).toEqual([1, 'active']);
    expect(group.pending).toHaveLength(12);
    expect(group.approved).toHaveLength(328);
    expect(group.pending.map((row) => row.legacyId)).toEqual(
      Array.from({ length: 12 }, (_, index) => `WAITING-${index + 1}`).sort(),
    );
    expect(new Set(group.approved.map((row) => row.legacyId)).size).toBe(328);
    expect(group.approved.every((row) => row.legacyId.startsWith('DONE-'))).toBe(true);
  });

  it('shows before and after on a row, and nothing else', async () => {
    await seedRule('R-DIFF', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'recDIFF',
        ruleId: 'R-DIFF',
        column: 'phone',
        previousValue: '06 12 34 56 78',
        nextValue: '+31612345678',
      },
    ]);

    const { status, body } = await loadDetail('R-DIFF');

    // 1.2.3: "Every row shows previousValue and nextValue side by side."
    // Whole-object equality, so a missing field and a field the row has no
    // business carrying both fail this. `ruleId` and `version` are deliberately
    // not on a row — the rule id is the detail's and the version is its block's.
    expect(status).toBe(200);
    expect(body).toEqual({
      ruleId: 'R-DIFF',
      ruleName: 'R-DIFF name',
      description: 'R-DIFF description',
      ambiguous: false,
      version: 1,
      versions: [
        {
          version: 1,
          state: 'active',
          pending: [
            {
              table: 'patient',
              legacyId: 'recDIFF',
              column: 'phone',
              previousValue: '06 12 34 56 78',
              nextValue: '+31612345678',
            },
          ],
          approved: [],
        },
      ],
      guidance: null,
      guidanceVersion: null,
      queuedForRevision: false,
    });
  });

  it('gives an ambiguous rule’s rows no nextValue at all, and the rule’s description instead', async () => {
    await seedRule('R-VAGUE', [1], 1, {
      ambiguous: true,
      description: 'two patients share this email; which one keeps it is a human call',
    });
    await seedFindings(patientRules, [
      { legacyId: 'recVAGUE-1', ruleId: 'R-VAGUE', column: 'email', previousValue: 'a@x.nl' },
      {
        legacyId: 'recVAGUE-2',
        ruleId: 'R-VAGUE',
        column: 'email',
        previousValue: 'a@x.nl',
        status: 'approved',
      },
    ]);

    const { status, body } = await loadDetail('R-VAGUE');
    const rows = allRows(body);

    // 1.1.12 and 1.2.3's second sentence: an ambiguous rule's rows show the
    // previous value and the rule's description in place of a new value. The
    // key is absent, not null — asserted with `Object.hasOwn`, because a null
    // check would pass on a row that sent one. Ambiguity is the rule's, so it
    // is on the detail and never on a block or a row.
    expect(status).toBe(200);
    expect(body.ambiguous).toBe(true);
    expect(body.description).toBe(
      'two patients share this email; which one keeps it is a human call',
    );
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(Object.hasOwn(row, 'nextValue')).toBe(false);
      expect(row.previousValue).toBe('a@x.nl');
    }
  });

  it('keeps nextValue null on a rule that proposes emptying a column', async () => {
    await seedRule('R-CLEAR', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'recCLEAR',
        ruleId: 'R-CLEAR',
        column: 'phone',
        previousValue: 'onbekend',
        nextValue: null,
      },
    ]);

    const { body } = await loadDetail('R-CLEAR');
    const [row] = soleGroup(body).pending as DetailRowBody[];

    // The other half of the omission: a rule that is not ambiguous may
    // legitimately propose null — clear the column. So an absent `nextValue`
    // means "this rule cannot fix it" (1.1.12) and never "propose an empty
    // value", and a screen reading these two rows can tell them apart.
    expect(Object.hasOwn(row, 'nextValue')).toBe(true);
    expect(row).toEqual({
      table: 'patient',
      legacyId: 'recCLEAR',
      column: 'phone',
      previousValue: 'onbekend',
      nextValue: null,
    });
  });

  it('shows a declined row in neither section', async () => {
    await seedRule('R-CROSSED', [1], 1);
    await seedFindings(patientRules, [
      { legacyId: 'recLIVE', ruleId: 'R-CROSSED' },
      { legacyId: 'recDONE', ruleId: 'R-CROSSED', status: 'approved' },
      { legacyId: 'recGONE', ruleId: 'R-CROSSED', status: 'declined' },
    ]);

    const { status, body } = await loadDetail('R-CROSSED');
    const group = soleGroup(body);

    // 1.2.2 names two sections in a block and there is no third. A row crossed
    // out is settled forever (1.2.7, 1.2.9) — it is neither waiting for a
    // decision nor applied, so it is not on this screen at all.
    expect(status).toBe(200);
    expect(addresses(group.pending)).toEqual(['patient/recLIVE/phone']);
    expect(addresses(group.approved)).toEqual(['patient/recDONE/phone']);
  });

  it('groups a rule’s rows by the version that made them, newest version first', async () => {
    await seedRule('R-MOVED', [1, 2], 2);
    await seedFindings(patientRules, findings('R-MOVED', 3, { version: 1, prefix: 'OLD' }));
    await seedFindings(patientRules, findings('R-MOVED', 2, { version: 2, prefix: 'NEW' }));
    await seedFindings(
      patientRules,
      findings('R-MOVED', 1, { version: 2, prefix: 'NEWDONE', status: 'approved' }),
    );

    const { body } = await loadDetail('R-MOVED');
    const [current, previous] = body.versions;

    // A rule's rows outlive the version that made them: version 1's three are
    // what being superseded left behind, and they are addressable at version 1
    // (1.2.4, 1.2.7) exactly as version 2's are at version 2. Reading only the
    // active version hid them under a count that included them.
    //
    // `version` on the detail is still the active one, because that is what the
    // whole-rule Approve acts on — a different question from where rows came
    // from.
    expect(body.version).toBe(2);
    expect(body.versions.map((group) => [group.version, group.state])).toEqual([
      [2, 'active'],
      [1, 'superseded'],
    ]);
    expect(addresses(current.pending)).toEqual(['patient/NEW-1/phone', 'patient/NEW-2/phone']);
    expect(addresses(current.approved)).toEqual(['patient/NEWDONE-1/phone']);
    expect(addresses(previous.pending)).toEqual([
      'patient/OLD-1/phone',
      'patient/OLD-2/phone',
      'patient/OLD-3/phone',
    ]);
    expect(previous.approved).toEqual([]);
  });

  it('shows only this rule’s rows when another rule caught the same legacy rows', async () => {
    await seedRule('R-MINE', [1], 1);
    await seedRule('R-THEIRS', [1], 1);
    await seedFindings(patientRules, [
      { legacyId: 'recSHARED', ruleId: 'R-MINE', column: 'phone' },
      { legacyId: 'recSHARED', ruleId: 'R-THEIRS', column: 'email' },
      { legacyId: 'recOTHER', ruleId: 'R-THEIRS', column: 'email', status: 'approved' },
    ]);

    const { body } = await loadDetail('R-MINE');
    const group = soleGroup(body);

    // One rule, one fix (1.1.4): the reason a value changed is a single rule,
    // so the screen for one rule shows that rule's rows and no other's — even
    // where two rules caught the same legacy row, and even though both rules'
    // rows are version 1.
    expect(addresses(group.pending)).toEqual(['patient/recSHARED/phone']);
    expect(group.approved).toEqual([]);
  });

  it('shows rows from all three sources, each naming its own table', async () => {
    await seedRule('R-SPAN', [1], 1);
    await seedFindings(patientRules, [
      { legacyId: 'recP', ruleId: 'R-SPAN', column: 'phone', previousValue: '06-1' },
    ]);
    await seedFindings(intakeRules, [
      { legacyId: 'recI', ruleId: 'R-SPAN', column: 'submitted_at', previousValue: '31-01-2024' },
    ]);
    await seedFindings(consentRules, [
      {
        legacyId: 'recC',
        ruleId: 'R-SPAN',
        column: 'granted',
        previousValue: 'ja',
        status: 'approved',
      },
    ]);

    const { body } = await loadDetail('R-SPAN');
    const group = soleGroup(body);

    // A rule's scope is wider than one value and may span two tables (1.1.6),
    // and a finding is always field-shaped (1.1.7). Every row names the source
    // it is against, which is the part of its address neither the URL nor the
    // block it sits in carries — without it, no row action could be addressed
    // from this screen.
    expect(group.pending).toEqual([
      {
        table: 'patient',
        legacyId: 'recP',
        column: 'phone',
        previousValue: '06-1',
        nextValue: '+31612345678',
      },
      {
        table: 'intake',
        legacyId: 'recI',
        column: 'submitted_at',
        previousValue: '31-01-2024',
        nextValue: '+31612345678',
      },
    ]);
    expect(group.approved).toEqual([
      {
        table: 'consent',
        legacyId: 'recC',
        column: 'granted',
        previousValue: 'ja',
        nextValue: '+31612345678',
      },
    ]);
  });

  it('answers with an empty section rather than an error when a rule has decided nothing', async () => {
    await seedRule('R-FRESH', [1], 1);
    await seedFindings(patientRules, findings('R-FRESH', 4));

    const { status, body } = await loadDetail('R-FRESH');
    const group = soleGroup(body);

    // An empty section is a state, not a failure: a rule nobody has decided on
    // yet has four rows waiting and nothing applied.
    expect(status).toBe(200);
    expect(group.pending).toHaveLength(4);
    expect(group.approved).toEqual([]);
  });

  it('answers a rule that has found nothing with no blocks at all', async () => {
    await seedRule('R-SILENT', [1], 1);

    const { status, body } = await loadDetail('R-SILENT');

    // A real rule that has caught nothing. There is no version block, because a
    // block is a version that made rows; the rule is a 200 with an active
    // version and nothing under it, and the screen says so in words rather than
    // drawing two empty sections.
    expect(status).toBe(200);
    expect(body.version).toBe(1);
    expect(body.versions).toEqual([]);
  });

  it('answers a parked rule with no active version, and its rows under the version that made them', async () => {
    await seedRule('R-PARKED', [1], 1);
    await seedFindings(patientRules, findings('R-PARKED', 5));

    // Declining a rule leaves its rows exactly as they were (1.2.6); what
    // changes is that the version goes inactive.
    await ruleVersions.decline('R-PARKED', 'it matched Belgian numbers too');

    const { status, body } = await loadDetail('R-PARKED');
    const group = soleGroup(body);

    // A rule waiting on a revision is a real rule the screen can be pointed at,
    // so this is a 200 and not a 500. No version is active, so there is no
    // whole-rule press to make and `version` says null — but the five rows the
    // decline left are still findings, still counted on the line (1.2.1) and
    // still decidable one at a time, so they are listed under the version that
    // made them. This is the shape the screen used to answer with nothing at
    // all: "290 pending" over "No rows are awaiting a decision".
    expect(status).toBe(200);
    expect({
      ruleId: body.ruleId,
      ruleName: body.ruleName,
      version: body.version,
      // What it was told, shown back so it can be refined rather than retyped (1.5.1).
      guidance: body.guidance,
      guidanceVersion: body.guidanceVersion,
      queuedForRevision: body.queuedForRevision,
    }).toEqual({
      ruleId: 'R-PARKED',
      ruleName: 'R-PARKED name',
      version: null,
      guidance: 'it matched Belgian numbers too',
      guidanceVersion: 1,
      queuedForRevision: true,
    });
    expect([group.version, group.state]).toEqual([1, 'needsReview']);
    expect(group.pending).toHaveLength(5);
    expect(group.approved).toEqual([]);
  });

  it('answers a rule whose rows are all on a superseded version, its newer one having found nothing', async () => {
    await seedRule('R-STRANDED', [1, 2], 1);
    await seedFindings(patientRules, findings('R-STRANDED', 18, { version: 1 }));
    // Version 2 was written and activated, then sent back to be rewritten. It
    // never found anything; version 1's rows are all this rule has.
    await ruleVersions.activate('R-STRANDED', 2);
    await ruleVersions.decline('R-STRANDED', 'an empty unit is not always kilograms');

    const { status, body } = await loadDetail('R-STRANDED');
    const group = soleGroup(body);

    // P47's shape, and the same bug the other way round: the list named version
    // 2 and counted its rows, of which there are none, so eighteen findings had
    // no count and no screen. They are version 1's, and that is where they show.
    expect(status).toBe(200);
    expect(body.version).toBe(null);
    expect([group.version, group.state]).toEqual([1, 'superseded']);
    expect(group.pending).toHaveLength(18);
  });

  it('answers 404 for a rule id nobody has written', async () => {
    await seedRule('R-REAL', [1], 1);
    await seedFindings(patientRules, findings('R-REAL', 1));

    const { status } = await loadDetail('R-IMAGINED');

    // Not a 200 with an invented name and an empty pair of sections: a rule
    // that does not exist is not a rule with nothing to do.
    expect(status).toBe(404);
  });

  it('returns the same order on two consecutive loads: patient, intake, consent, then legacy id, then column', async () => {
    await seedRule('R-ORDER', [1], 1);
    // Seeded in the reverse of the expected order, so the answer cannot be the
    // order rows happen to have been written in.
    await seedFindings(consentRules, [
      { legacyId: 'C-2', ruleId: 'R-ORDER', column: 'granted' },
      { legacyId: 'C-1', ruleId: 'R-ORDER', column: 'granted' },
    ]);
    await seedFindings(intakeRules, [
      { legacyId: 'I-1', ruleId: 'R-ORDER', column: 'submitted_at' },
    ]);
    await seedFindings(patientRules, [
      { legacyId: 'P-2', ruleId: 'R-ORDER', column: 'phone' },
      { legacyId: 'P-1', ruleId: 'R-ORDER', column: 'phone' },
      { legacyId: 'P-1', ruleId: 'R-ORDER', column: 'email' },
    ]);

    const first = await loadDetail('R-ORDER');
    const second = await loadDetail('R-ORDER');

    // Nothing specifies an order, so this one is arbitrary — but it is fixed.
    // A screen whose rows reshuffle between two loads is worse than one whose
    // order nobody chose, and a row a user is halfway through deciding on must
    // not move under them. Grouping by version does not disturb it: the sources
    // are read in order and each row joins the block of the version that made it.
    expect(addresses(soleGroup(first.body).pending)).toEqual([
      'patient/P-1/email',
      'patient/P-1/phone',
      'patient/P-2/phone',
      'intake/I-1/submitted_at',
      'consent/C-1/granted',
      'consent/C-2/granted',
    ]);
    expect(addresses(soleGroup(second.body).pending)).toEqual(
      addresses(soleGroup(first.body).pending),
    );
  });
});
