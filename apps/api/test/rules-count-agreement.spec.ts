import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import {
  LegacyPatientRule,
  type LegacyRuleRow,
  type LegacyRuleStatus,
} from '../src/legacy/legacy-rule.entity';
import type { RuleDetailResponse } from '../src/rule-detail/rule-detail.controller';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import type { RulesListResponse } from '../src/rules-list/rules-list.controller';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * The rules screen's two reads, held against each other (1.2.1, 1.2.2).
 *
 * `rules-list.spec.ts` owns what a line says and `rule-detail.spec.ts` owns
 * what expanding one shows. Neither could see the thing that was actually
 * wrong, because it lived between them: the list counted the rows of the one
 * version it chose to name, the detail read the active version's rows alone,
 * and a rule whose rows sat anywhere else showed "290 pending" above "No rows
 * are awaiting a decision" — or, the same fault the other way round, showed no
 * count at all above eighteen rows nobody could reach from this screen.
 *
 * So what this suite asserts is the agreement itself: for every rule the list
 * returns, the number on the line is the number of rows the detail lists. It is
 * a property of the pair, not of either half, and it holds whatever version made
 * the rows — which is the definition the two services now share.
 *
 * The shapes are the ones the bug was found in: a rule whose active version has
 * the rows, a rule parked for a rewrite whose rows are on the parked version
 * (I34), a rule whose rows are on a superseded version while a later one has
 * none (P47), and a rule whose rows are spread over two versions.
 *
 * Rows are seeded straight through the repositories, as every suite on this
 * screen does: agreeing about what a run left behind is what is under test, not
 * the run.
 */

/** One rule row, as a run would have left it. Pending unless said otherwise. */
interface FindingSeed {
  legacyId: string;
  ruleId: string;
  version?: number;
  status?: LegacyRuleStatus;
}

/** What one line says, and what opening it shows: pending, then approved. */
type Counts = [number, number];

describe('the rules screen’s count and the rows behind it', () => {
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
   * its own — the key is `(legacyId, ruleId, version, column)`, so rows sharing
   * a legacy id would be one row overwritten, not many counted.
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

  /** The screen load (1.2.1). */
  async function loadRules(): Promise<RulesListResponse> {
    const response = await request(app.getHttpServer()).get('/rules');

    expect(response.status).toBe(200);

    return response.body as RulesListResponse;
  }

  /** Expanding one rule (1.2.2). */
  async function loadDetail(ruleId: string): Promise<RuleDetailResponse> {
    const response = await request(app.getHttpServer()).get(`/rules/${ruleId}`);

    expect(response.status).toBe(200);

    return response.body as RuleDetailResponse;
  }

  /** How many rows the expanded rule lists, over every one of its blocks. */
  function shown(detail: RuleDetailResponse): Counts {
    return [
      detail.versions.reduce((total, group) => total + group.pending.length, 0),
      detail.versions.reduce((total, group) => total + group.approved.length, 0),
    ];
  }

  /**
   * The four shapes, seeded together, because the agreement is asserted over
   * the whole screen at once rather than a rule at a time.
   */
  async function seedScreen(): Promise<void> {
    // A rule whose active version has the rows. Two declined ones as well, which
    // are settled (1.2.7) and belong to neither side of the comparison.
    await seedRule('R-COUNT-LIVE', [1], 1);
    await seedFindings(patientRules, findings('R-COUNT-LIVE', 4, { prefix: 'LIVE-WAIT' }));
    await seedFindings(
      patientRules,
      findings('R-COUNT-LIVE', 2, { prefix: 'LIVE-DONE', status: 'approved' }),
    );
    await seedFindings(
      patientRules,
      findings('R-COUNT-LIVE', 2, { prefix: 'LIVE-GONE', status: 'declined' }),
    );

    // I34's shape: one version, parked for a rewrite, and every row is on it.
    await seedRule('R-COUNT-PARKED', [1], 1);
    await seedFindings(patientRules, findings('R-COUNT-PARKED', 5, { prefix: 'PARKED' }));
    await ruleVersions.decline('R-COUNT-PARKED', 'it matched Belgian numbers too');

    // P47's shape: the rows are on version 1, which version 2 superseded;
    // version 2 found nothing and is itself now waiting to be rewritten.
    await seedRule('R-COUNT-STRANDED', [1, 2], 1);
    await seedFindings(
      patientRules,
      findings('R-COUNT-STRANDED', 3, { version: 1, prefix: 'STRANDED' }),
    );
    await ruleVersions.activate('R-COUNT-STRANDED', 2);
    await ruleVersions.decline('R-COUNT-STRANDED', 'an empty unit is not always kilograms');

    // Rows on two versions at once: the active one, and the one it superseded.
    await seedRule('R-COUNT-SPREAD', [1, 2], 2);
    await seedFindings(
      patientRules,
      findings('R-COUNT-SPREAD', 5, { version: 1, prefix: 'SPREAD-OLD' }),
    );
    await seedFindings(
      patientRules,
      findings('R-COUNT-SPREAD', 3, { version: 2, prefix: 'SPREAD-NEW' }),
    );
    await seedFindings(
      patientRules,
      findings('R-COUNT-SPREAD', 1, {
        version: 2,
        prefix: 'SPREAD-DONE',
        status: 'approved',
      }),
    );
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
    await seedScreen();
  });

  it('counts on every line exactly the rows expanding that line shows', async () => {
    const lines = await loadRules();
    const counted: Record<string, Counts> = {};
    const listed: Record<string, Counts> = {};

    for (const line of lines) {
      counted[line.ruleId] = [line.pending, line.approved];
      listed[line.ruleId] = shown(await loadDetail(line.ruleId));
    }

    // The whole of it, in one assertion that prints both sides keyed by rule:
    // whatever a line says, opening it shows that many rows. The four rules
    // below are four different ways the two used to disagree.
    expect(counted).toEqual(listed);

    // And not vacuously: every rule seeded is on the screen, so this is an
    // agreement about real numbers rather than about an empty list.
    expect(Object.keys(counted).sort()).toEqual([
      'R-COUNT-LIVE',
      'R-COUNT-PARKED',
      'R-COUNT-SPREAD',
      'R-COUNT-STRANDED',
    ]);
  });

  it('says the numbers themselves, so the agreement cannot be two zeroes', async () => {
    const lines = await loadRules();

    // Rules with work first, most pending first, then the versions waiting to
    // be rewritten (1.2.1). The version on a line is the one the rule is now —
    // the active one, else the one queued for the rewrite — and never where the
    // counts came from: R-COUNT-STRANDED names v2, which found nothing, and
    // carries v1's three rows.
    expect(
      lines.map((line) => [
        line.ruleId,
        line.version,
        line.pending,
        line.approved,
        line.queuedForRevision,
      ]),
    ).toEqual([
      ['R-COUNT-SPREAD', 2, 8, 1, false],
      ['R-COUNT-LIVE', 1, 4, 2, false],
      ['R-COUNT-PARKED', 1, 5, 0, true],
      ['R-COUNT-STRANDED', 2, 3, 0, true],
    ]);
  });

  it('shows each rule’s rows under the version that made them, and says what that version is', async () => {
    const blocks: Record<string, [number, string, number, number][]> = {};

    for (const ruleId of ['R-COUNT-LIVE', 'R-COUNT-PARKED', 'R-COUNT-STRANDED', 'R-COUNT-SPREAD']) {
      const detail = await loadDetail(ruleId);

      blocks[ruleId] = detail.versions.map((group) => [
        group.version,
        group.state,
        group.pending.length,
        group.approved.length,
      ]);
    }

    // Newest version first, each block saying what its version is now, so a
    // reader can tell the rule as it runs from the rows it left behind. A
    // version that found nothing is no block at all — R-COUNT-STRANDED's v2 and
    // R-COUNT-PARKED have one block each, not an empty second one.
    expect(blocks).toEqual({
      'R-COUNT-LIVE': [[1, 'active', 4, 2]],
      'R-COUNT-PARKED': [[1, 'needsReview', 5, 0]],
      'R-COUNT-STRANDED': [[1, 'superseded', 3, 0]],
      'R-COUNT-SPREAD': [
        [2, 'active', 3, 1],
        [1, 'superseded', 5, 0],
      ],
    });
  });

  it('agrees on a rule whose every row has been decided, and on one nobody has touched', async () => {
    await dataSource.query(`DELETE FROM legacy_patient_rule`);
    await dataSource.query(`DELETE FROM rule_version`);
    await dataSource.query(`DELETE FROM rule`);

    // One rule with nothing but applied rows, one with nothing but declined
    // ones, and one that has never found anything.
    await seedRule('R-COUNT-APPLIED', [1], 1);
    await seedRule('R-COUNT-CROSSED', [1], 1);
    await seedRule('R-COUNT-QUIET', [1], 1);
    await seedFindings(
      patientRules,
      findings('R-COUNT-APPLIED', 6, { prefix: 'APPLIED', status: 'approved' }),
    );
    await seedFindings(
      patientRules,
      findings('R-COUNT-CROSSED', 3, { prefix: 'CROSSED', status: 'declined' }),
    );

    const lines = await loadRules();
    const counted: Record<string, Counts> = {};
    const listed: Record<string, Counts> = {};

    for (const line of lines) {
      counted[line.ruleId] = [line.pending, line.approved];
      listed[line.ruleId] = shown(await loadDetail(line.ruleId));
    }

    // The applied rule is the only line: a rule whose rows were all crossed out
    // changed nothing and a rule that found nothing has nothing to show, so
    // neither is on the screen (1.2.1). The one that is agrees with itself.
    expect(counted).toEqual({ 'R-COUNT-APPLIED': [0, 6] });
    expect(counted).toEqual(listed);
  });
});
