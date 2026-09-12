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
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import type { RulesListResponse } from '../src/rules-list/rules-list.controller';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * The rules screen's list (1.2.1), over HTTP and against a real database.
 *
 * No rules and no registry anywhere in this suite: loading the screen runs no
 * rule. What it reads is what a run left behind, so every fixture is seeded
 * straight through the repositories, the same way `approve.spec.ts` seeds the
 * rows a press acts on.
 *
 * Nothing here asserts that a service was called. Every assertion is about the
 * body the endpoint answered with, because the list *is* the behaviour: a suite
 * watching a call could not tell a rule that was counted from one that was
 * silently left off the screen.
 *
 * Each test uses rule ids of its own, so no test's rules can be picked up in
 * another's list.
 */

/** One rule row, as a run would have left it. Pending unless said otherwise. */
interface FindingSeed {
  legacyId: string;
  ruleId: string;
  version?: number;
  status?: LegacyRuleStatus;
}

describe('the rules list', () => {
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
   * its own — the primary key is `(legacyId, ruleId, version, column)`, so rows
   * that shared a legacy id would be one row overwritten, not many counted.
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

  /** The screen load itself (1.2.1). */
  async function loadRules(): Promise<{ status: number; body: RulesListResponse }> {
    const response = await request(app.getHttpServer()).get('/rules');

    return { status: response.status, body: response.body as RulesListResponse };
  }

  /** Which rules the screen shows, in the order it shows them. */
  async function listedRules(): Promise<[string, number][]> {
    const { body } = await loadRules();

    return body.map((entry) => [entry.ruleId, entry.pending]);
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

  it('shows a rule whose active version has pending rows, once, with that count', async () => {
    await seedRule('R-WORK', [1], 1);
    await seedFindings(patientRules, findings('R-WORK', 340));

    const { status, body } = await loadRules();

    // 1.2.1, first scenario: the rule appears with the rows it caught. One
    // line, not one per row, and the version on it is the active one — which is
    // what every row action has to send back. Whole-body equality, so a field
    // the list has no business carrying fails this too.
    expect(status).toBe(200);
    expect(body).toEqual([
      {
        ruleId: 'R-WORK',
        ruleName: 'R-WORK name',
        version: 1,
        pending: 340,
      },
    ]);
  });

  it('leaves out a rule whose active version has rows but none of them pending', async () => {
    await seedRule('R-SETTLED-A', [1], 1);
    await seedRule('R-SETTLED-D', [1], 1);
    await seedRule('R-PENDING', [1], 1);
    await seedFindings(patientRules, findings('R-SETTLED-A', 4, { status: 'approved' }));
    await seedFindings(patientRules, findings('R-SETTLED-D', 3, { status: 'declined' }));
    await seedFindings(patientRules, findings('R-PENDING', 1));

    // 1.2.1, second scenario. A rule everybody has already decided has nothing
    // waiting, and an empty section is not a rule with work — approved rows
    // belong to the detail screen (1.2.2), declined ones are settled (1.2.7).
    // The third rule is here so an empty list cannot pass this test by itself.
    expect(await listedRules()).toEqual([['R-PENDING', 1]]);
  });

  it('leaves out a rule with pending rows whose version is not active', async () => {
    await seedRule('R-UNRELEASED', [1]);
    await seedRule('R-PARKED', [1], 1);
    await seedRule('R-LIVE', [1], 1);
    await seedFindings(patientRules, findings('R-UNRELEASED', 9));
    await seedFindings(patientRules, findings('R-PARKED', 7));
    await seedFindings(patientRules, findings('R-LIVE', 2));

    // Declining leaves the rule's rows exactly as they were (1.2.6): what takes
    // the rule off the screen is the version going inactive, which is the only
    // thing the screen filters on (1.2.1).
    await ruleVersions.decline('R-PARKED', 'it matched Belgian numbers too');

    expect(await listedRules()).toEqual([['R-LIVE', 2]]);
  });

  it('leaves out a rule whose pending rows all belong to a superseded version', async () => {
    await seedRule('R-SUPERSEDED', [1, 2], 2);
    await seedFindings(patientRules, findings('R-SUPERSEDED', 6, { version: 1 }));
    await seedFindings(
      patientRules,
      findings('R-SUPERSEDED', 2, { version: 2, status: 'approved' }),
    );

    // The count is what pressing Approve on the rule would clear, and that
    // press moves the pending rows of the *active* version. Version 1's rows
    // are the ones a decline left lying around; counting them would put the
    // rule back on the screen with a number no button can move.
    expect(await listedRules()).toEqual([]);
  });

  it('counts only the active version’s rows when an older version left some pending', async () => {
    await seedRule('R-BOTH', [1, 2], 2);
    await seedFindings(patientRules, findings('R-BOTH', 5, { version: 1, prefix: 'OLD' }));
    await seedFindings(patientRules, findings('R-BOTH', 3, { version: 2, prefix: 'NEW' }));

    // Same join, the other way round: the rule does have work, and the number
    // beside it is three rather than eight.
    expect(await listedRules()).toEqual([['R-BOTH', 3]]);
  });

  it('sorts by how many rows each rule caught, most first', async () => {
    // The ids are chosen to contradict the counts: read in rule-id order — the
    // order SQLite hands the active versions back in, through the partial
    // unique index on `rule_id` — these are 1, 12, 5. Only a sort of its own
    // can answer 12, 5, 1, so this test fails the moment the ordering is the
    // database's rather than the screen's.
    await seedRule('R-A', [1], 1);
    await seedRule('R-B', [1], 1);
    await seedRule('R-C', [1], 1);
    await seedFindings(patientRules, findings('R-A', 1));
    await seedFindings(patientRules, findings('R-B', 12));
    await seedFindings(patientRules, findings('R-C', 5));

    // 1.2.1: "Rules sort by how many rows each caught, most first."
    expect(await listedRules()).toEqual([
      ['R-B', 12],
      ['R-C', 5],
      ['R-A', 1],
    ]);
  });

  it('sums a rule’s pending rows across the three source tables', async () => {
    await seedRule('R-SPAN', [1], 1);
    await seedFindings(patientRules, findings('R-SPAN', 2, { prefix: 'P' }));
    await seedFindings(intakeRules, findings('R-SPAN', 3, { prefix: 'I' }));
    await seedFindings(consentRules, findings('R-SPAN', 1, { prefix: 'C' }));

    // A rule's scope is wider than one table (1.1.6), and the screen shows one
    // number per rule: six rows caught, one line, no per-table breakdown.
    expect(await listedRules()).toEqual([['R-SPAN', 6]]);
  });

  it('counts only the pending rows of a rule that has decided ones too', async () => {
    await seedRule('R-MIXED', [1], 1);
    await seedFindings(patientRules, findings('R-MIXED', 2, { prefix: 'WAITING' }));
    await seedFindings(
      patientRules,
      findings('R-MIXED', 7, { prefix: 'DONE', status: 'approved' }),
    );
    await seedFindings(
      intakeRules,
      findings('R-MIXED', 3, { prefix: 'REJECTED', status: 'declined' }),
    );

    // 1.2.1 counts rows in pending. The seven approved ones are the detail
    // screen's second section (1.2.2) and the three declined ones are settled
    // (1.2.7); neither is work waiting for a decision.
    expect(await listedRules()).toEqual([['R-MIXED', 2]]);
  });

  it('answers an empty list rather than an error when nothing has work', async () => {
    const empty = await loadRules();

    // No rules at all.
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    await seedRule('R-QUIET', [1], 1);
    await seedFindings(patientRules, findings('R-QUIET', 3, { status: 'approved' }));

    const quiet = await loadRules();

    // Rules, but nothing pending on any of them. An empty screen is a state,
    // not a failure.
    expect(quiet.status).toBe(200);
    expect(quiet.body).toEqual([]);
  });
});
