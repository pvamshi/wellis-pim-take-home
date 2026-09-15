import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import {
  LegacyPatientRule,
  type LegacyRuleRow,
  type LegacyRuleStatus,
} from '../src/legacy/legacy-rule.entity';
import type { RowDetailResponse } from '../src/row-detail/row-detail.controller';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * One row expanded (1.6.3), over HTTP and against a real database.
 *
 * This is `rule-detail.spec.ts`'s transpose: no rule and no registry runs
 * here either, because what the screen reads is what a run (or an approve,
 * or a decline) already left behind. Every fixture is seeded straight
 * through the repositories, the same way that suite's is.
 *
 * `Rule` is seeded but `RuleVersion` never is: unlike the rules screen's
 * detail, this read applies no active-version filter at all (see
 * `row-detail.service.ts`'s own comment), so there is nothing for a version's
 * `status` to gate here.
 *
 * Each test uses legacy ids of its own, so no test's rows can appear in
 * another's detail.
 */

/** One rule row, as a run (or a hand decision) would have left it. */
interface FindingSeed {
  legacyId: string;
  ruleId: string;
  version?: number;
  column?: string;
  previousValue?: string | null;
  nextValue?: string | null;
  status?: LegacyRuleStatus;
}

describe('the row detail', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let rules: Repository<Rule>;
  let patients: Repository<LegacyPatient>;
  let consents: Repository<LegacyConsent>;
  let patientRules: Repository<LegacyPatientRule>;

  /** A rule: what it is, with no version at all — this screen reads none. */
  async function seedRule(
    ruleId: string,
    options: { ambiguous?: boolean; ruleName?: string; description?: string } = {},
  ): Promise<void> {
    await rules.save({
      ruleId,
      ruleName: options.ruleName ?? `${ruleId} name`,
      description: options.description ?? `${ruleId} description`,
      ambiguous: options.ambiguous ?? false,
    });
  }

  /** A patient row, with every column but the legacy id and raw data given a value. */
  async function seedPatient(
    legacyPatientId: string,
    overrides: Partial<LegacyPatient> = {},
  ): Promise<LegacyPatient> {
    return await patients.save({
      legacyPatientId,
      fullName: null,
      email: null,
      dob: null,
      sex: null,
      bsn: null,
      phone: null,
      city: null,
      weight: null,
      weightUnit: null,
      heightCm: null,
      status: null,
      signupDate: null,
      source: null,
      rawData: `{"id":"${legacyPatientId}"}`,
      ...overrides,
    });
  }

  async function seedConsent(
    legacyPatientId: string,
    overrides: Partial<LegacyConsent> = {},
  ): Promise<LegacyConsent> {
    return await consents.save({
      legacyPatientId,
      type: null,
      action: null,
      at: null,
      version: null,
      rawData: `{"id":"${legacyPatientId}"}`,
      ...overrides,
    });
  }

  /** Rule rows a run (or a decision) would have left. Pending unless said otherwise. */
  async function seedFindings(
    repository: Repository<LegacyRuleRow>,
    rows: FindingSeed[],
  ): Promise<void> {
    const complete = rows.map((row) => ({
      version: 1,
      column: 'phone',
      previousValue: 'old',
      nextValue: 'new',
      status: 'pending' as LegacyRuleStatus,
      reason: null,
      ...row,
    }));

    await repository.insert(complete);
  }

  /** Expanding one row (1.6.3). */
  async function loadRow(
    table: string,
    legacyId: string,
  ): Promise<{ status: number; body: RowDetailResponse }> {
    const response = await request(app.getHttpServer()).get(
      `/rows/${table}/${encodeURIComponent(legacyId)}`,
    );

    return { status: response.status, body: response.body as RowDetailResponse };
  }

  /** The patient columns `RowDetailService` reports, as `dataRows` should hold them. */
  function patientValues(row: LegacyPatient): Record<string, string | null> {
    return {
      full_name: row.fullName,
      email: row.email,
      dob: row.dob,
      sex: row.sex,
      bsn: row.bsn,
      phone: row.phone,
      city: row.city,
      weight: row.weight,
      weight_unit: row.weightUnit,
      height_cm: row.heightCm,
      status: row.status,
      signup_date: row.signupDate,
      source: row.source,
    };
  }

  function consentValues(row: LegacyConsent): Record<string, string | null> {
    return {
      type: row.type,
      action: row.action,
      at: row.at,
      version: row.version,
    };
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
    patients = dataSource.getRepository(LegacyPatient);
    consents = dataSource.getRepository(LegacyConsent);
    patientRules = dataSource.getRepository(LegacyPatientRule);
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
    await dataSource.query(`DELETE FROM legacy_patient`);
    await dataSource.query(`DELETE FROM legacy_intake`);
    await dataSource.query(`DELETE FROM legacy_consent`);
  });

  it('groups findings from several rules, split into pending and settled', async () => {
    await seedRule('R-A', { ruleName: 'Rule A', description: 'A description' });
    await seedRule('R-B', { ruleName: 'Rule B', description: 'B description' });
    const patient = await seedPatient('P-0310');

    await seedFindings(patientRules, [
      {
        legacyId: 'P-0310',
        ruleId: 'R-A',
        version: 1,
        column: 'email',
        previousValue: 'old@x.nl',
        nextValue: 'new@x.nl',
        status: 'pending',
      },
      {
        legacyId: 'P-0310',
        ruleId: 'R-A',
        version: 1,
        column: 'phone',
        previousValue: '06-1',
        nextValue: '+31-6-1',
        status: 'approved',
      },
      {
        legacyId: 'P-0310',
        ruleId: 'R-B',
        version: 1,
        column: 'city',
        previousValue: 'Rotterdam',
        nextValue: 'Amsterdam',
        status: 'declined',
      },
    ]);

    const { status, body } = await loadRow('patient', 'P-0310');

    // 1.6.3: findings shown grouped by the rule that made them, each with
    // rule name, ambiguity, column, before and after.
    expect(status).toBe(200);
    expect(body.table).toBe('patient');
    expect(body.legacyId).toBe('P-0310');
    expect(body.dataRows).toEqual([patientValues(patient)]);
    expect(body.findings).toEqual([
      {
        ruleId: 'R-A',
        ruleName: 'Rule A',
        description: 'A description',
        ambiguous: false,
        version: 1,
        pending: [{ column: 'email', previousValue: 'old@x.nl', nextValue: 'new@x.nl' }],
        settled: [
          { column: 'phone', previousValue: '06-1', nextValue: '+31-6-1', status: 'approved' },
        ],
      },
      {
        ruleId: 'R-B',
        ruleName: 'Rule B',
        description: 'B description',
        ambiguous: false,
        version: 1,
        pending: [],
        settled: [
          {
            column: 'city',
            previousValue: 'Rotterdam',
            nextValue: 'Amsterdam',
            status: 'declined',
          },
        ],
      },
    ]);
  });

  it('groups two versions of the same rule as two separate groups', async () => {
    await seedRule('R-MOVED');
    await seedPatient('P-0500');

    // A row-level press can act on any version by address, and RowListService
    // itself applies no version filter — a legacy row can carry a superseded
    // version's pending finding alongside a newer version's, and both are
    // real, addressable work (decisions doc: grouping key is (ruleId,
    // version), not ruleId alone).
    await seedFindings(patientRules, [
      { legacyId: 'P-0500', ruleId: 'R-MOVED', version: 1, column: 'phone', status: 'pending' },
      { legacyId: 'P-0500', ruleId: 'R-MOVED', version: 2, column: 'phone', status: 'pending' },
    ]);

    const { body } = await loadRow('patient', 'P-0500');

    expect(body.findings).toHaveLength(2);
    expect(body.findings.map((group) => group.version)).toEqual([1, 2]);
    expect(body.findings.every((group) => group.ruleId === 'R-MOVED')).toBe(true);
  });

  it('keeps nextValue null, present rather than absent, for a non-ambiguous rule clearing a column', async () => {
    await seedRule('R-CLEAR');
    await seedPatient('P-CLEAR');

    await seedFindings(patientRules, [
      {
        legacyId: 'P-CLEAR',
        ruleId: 'R-CLEAR',
        column: 'phone',
        previousValue: 'onbekend',
        nextValue: null,
        status: 'pending',
      },
    ]);

    const { body } = await loadRow('patient', 'P-CLEAR');
    const [finding] = body.findings[0].pending;

    // The other half of the omission rule-detail.service.ts already draws: a
    // non-ambiguous rule may legitimately propose null (clear the column), so
    // its key stays present and null rather than vanishing like an ambiguous
    // rule's does.
    expect(Object.hasOwn(finding, 'nextValue')).toBe(true);
    expect(finding).toEqual({ column: 'phone', previousValue: 'onbekend', nextValue: null });
  });

  it('omits nextValue entirely for an ambiguous rule’s findings', async () => {
    await seedRule('R-VAGUE', {
      ambiguous: true,
      description: 'two patients share this email; which one keeps it is a human call',
    });
    await seedPatient('P-0781');

    await seedFindings(patientRules, [
      {
        legacyId: 'P-0781',
        ruleId: 'R-VAGUE',
        column: 'email',
        previousValue: 'shared@x.nl',
        nextValue: null,
        status: 'pending',
      },
    ]);

    const { body } = await loadRow('patient', 'P-0781');
    const [group] = body.findings;
    const [finding] = group.pending;

    // 1.1.12 / 1.2.3: an ambiguous rule's findings carry no proposed value at
    // all — the key must be absent, not merely null, so a `null` check alone
    // would pass on a row that sent one.
    expect(group.ambiguous).toBe(true);
    expect(Object.hasOwn(finding, 'nextValue')).toBe(false);
    expect(finding.previousValue).toBe('shared@x.nl');
  });

  it('returns every physical row sharing a duplicated legacy id (1.0.3, 1.0.4)', async () => {
    const first = await seedConsent('P-DUP', { type: 'privacy', action: 'granted' });
    const second = await seedConsent('P-DUP', { type: 'marketing', action: 'revoked' });

    const { status, body } = await loadRow('consent', 'P-DUP');

    const expectedOrder = [first, second].sort((left, right) => left.id.localeCompare(right.id));

    expect(status).toBe(200);
    expect(body.dataRows).toEqual(expectedOrder.map(consentValues));
    expect(body.dataRows).toHaveLength(2);
    expect(body.findings).toEqual([]);
  });

  it('answers a row with no findings with its values and an empty list', async () => {
    const patient = await seedPatient('P-0044', { fullName: 'A Clean Patient' });

    const { status, body } = await loadRow('patient', 'P-0044');

    expect(status).toBe(200);
    expect(body.dataRows).toEqual([patientValues(patient)]);
    expect(body.findings).toEqual([]);
  });

  it('answers 404 for a legacy id the data table has never seen', async () => {
    await seedPatient('P-REAL');

    const { status } = await loadRow('patient', 'P-GHOST');

    expect(status).toBe(404);
  });

  it('answers 404 by the data table alone, even when a finding exists for that legacy id', async () => {
    // A data-integrity edge case, not something the normal write paths can
    // produce, but the 404 must key off legacy_patient and nothing else.
    await seedRule('R-ORPHAN');
    await seedFindings(patientRules, [{ legacyId: 'P-ORPHAN', ruleId: 'R-ORPHAN' }]);

    const { status } = await loadRow('patient', 'P-ORPHAN');

    expect(status).toBe(404);
  });

  it('rejects a table that is not one of the three legacy sources', async () => {
    const { status } = await loadRow('nonsense', 'P-0044');

    expect(status).toBe(400);
  });

  it('returns the same order on two consecutive loads', async () => {
    await seedRule('R-X');
    await seedRule('R-Y');
    await seedPatient('P-ORDER');

    // Seeded out of the expected order, so the answer cannot be the order
    // rows happen to have been written in.
    await seedFindings(patientRules, [
      { legacyId: 'P-ORDER', ruleId: 'R-Y', version: 2, column: 'city' },
      { legacyId: 'P-ORDER', ruleId: 'R-Y', version: 1, column: 'phone' },
      { legacyId: 'P-ORDER', ruleId: 'R-X', version: 1, column: 'email' },
    ]);

    const first = await loadRow('patient', 'P-ORDER');
    const second = await loadRow('patient', 'P-ORDER');

    // Groups ordered by ruleId ASC then version ASC.
    expect(first.body.findings.map((group) => `${group.ruleId}/${group.version}`)).toEqual([
      'R-X/1',
      'R-Y/1',
      'R-Y/2',
    ]);
    expect(second.body.findings).toEqual(first.body.findings);
  });
});
