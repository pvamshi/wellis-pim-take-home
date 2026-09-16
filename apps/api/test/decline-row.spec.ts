import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApplyRulesResponse } from '../src/apply-rules/apply-rules.controller';
import { AppModule } from '../src/app.module';
import type { ApproveResponse } from '../src/approve/approve.controller';
import type { DeclineRowResponse } from '../src/decline/decline.controller';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import {
  LegacyIntakeRule,
  LegacyPatientRule,
  type LegacyRuleRow,
  type LegacyRuleStatus,
} from '../src/legacy/legacy-rule.entity';
import type { RegisteredRule, RuleFunction } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { RuleRowDeclinesService } from '../src/rules/rule-row-declines.service';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * Crossing out one row with "modify the rule" unticked (1.2.7), over HTTP and
 * against a real database — and the thing that makes it stick (1.2.9).
 *
 * Nothing here asserts that a service was called. Every assertion reads the
 * rule table, the version table or the legacy data table back once the response
 * came in, because those three are the whole of 1.2.7: the row is declined, the
 * rule is untouched, and the data is not written. A test that watched a call
 * could tell none of that apart.
 *
 * `rule-findings.spec.ts` and `apply-rules.spec.ts` already prove the
 * declined-row skip against a *seeded* declined row. What could not be proved
 * before this task is that the press an operator actually makes produces a row
 * that skip recognises, so the 1.2.9 test below crosses a row out through the
 * endpoint and then runs the rules for real.
 *
 * The fakes exist for those two tests only. This body of work is the
 * infrastructure rules run on, not the rules; the catalogue ships empty on
 * purpose and the registry is overridden the same way `apply-rules.spec.ts`
 * overrides it.
 *
 * Each test uses rule ids of its own, so no test's rows or active versions can
 * be picked up by another's press.
 */

/** A row of any table as the driver returns it, columns and all. */
type StoredRow = Record<string, unknown>;

/** The columns a seeded patient sets; the rest default to null. */
interface PatientSeed {
  legacyPatientId: string;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  rawData: string;
}

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

/** The four parts of a rule row's key a row-level press sends. */
interface RowAddressBody {
  table: string;
  legacyId: string;
  version: number;
  column: string;
  reason?: unknown;
}

/**
 * Proposes the international form of every Dutch number written the old way.
 *
 * The same fake `apply-rules.spec.ts` uses, and self-terminating for the same
 * reason (1.1.5): it matches on the column it rewrites, so a row it already
 * fixed stops matching. Only the two tests that press Apply rules need it.
 */
const proposePhone: RuleFunction = async (context) => {
  const patients = await context.find(LegacyPatient);

  return {
    ambiguity: false,
    updates: patients
      .filter((patient) => patient.phone?.startsWith('06') === true)
      .map((patient) => ({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'phone',
        prev: patient.phone,
        next: `+31${patient.phone?.slice(1) ?? ''}`,
      })),
  };
};

/**
 * Every fake the suite registers: two versions of each rule that gets run, so a
 * decline recorded under version 1 can be met by version 2 (1.2.9).
 */
const fakeRules: RegisteredRule[] = [
  { ruleId: 'R-FOREVER', version: 1, run: proposePhone },
  { ruleId: 'R-FOREVER', version: 2, run: proposePhone },
  { ruleId: 'R-SCOPE-A', version: 1, run: proposePhone },
  { ruleId: 'R-SCOPE-A', version: 2, run: proposePhone },
  { ruleId: 'R-SCOPE-B', version: 1, run: proposePhone },
  { ruleId: 'R-SCOPE-B', version: 2, run: proposePhone },
];

/**
 * The patients every test starts from, listed in the order SQLite returns them
 * for `ORDER BY legacy_id`, which is what `storedPatients` below compares.
 *
 * A function rather than a constant, because inserting writes the generated id
 * back into the object it was handed, and a shared object carrying a stale id
 * would be updated instead of inserted on the next test.
 *
 * P-0455 is 1.2.7's own patient. P-3 has no phone at all, so the phone fake
 * matches three of the four and a run's counts are not simply "every row".
 */
function fixedPatients(): PatientSeed[] {
  return [
    {
      legacyPatientId: 'P-0455',
      fullName: 'Ana de Vries',
      email: 'ana@old.example',
      phone: '0645500000',
      city: 'Utrecht',
      rawData: '{"id":"P-0455"}',
    },
    {
      legacyPatientId: 'P-1',
      fullName: 'Bram Jansen',
      email: 'bram@old.example',
      phone: '0611111111',
      city: 'Amsterdam',
      rawData: '{"id":"P-1"}',
    },
    {
      legacyPatientId: 'P-2',
      fullName: 'Cas Bakker',
      email: 'cas@old.example',
      phone: '0622222222',
      city: 'Rotterdam',
      rawData: '{"id":"P-2"}',
    },
    {
      legacyPatientId: 'P-3',
      fullName: 'Dee Smit',
      email: 'dee@old.example',
      phone: null,
      city: 'Den Haag',
      rawData: '{"id":"P-3"}',
    },
  ];
}

/** One intake, so a press can be routed to a second source's rule table. */
function fixedIntakes(): { legacyIntakeId: string; outcome: string; rawData: string }[] {
  return [{ legacyIntakeId: 'I-1', outcome: 'ok', rawData: '{"id":"I-1"}' }];
}

/**
 * Every legacy patient column, exactly as `fixedPatients` seeded it — the
 * unseeded ones null. What a press that writes no data has to leave behind.
 */
function seededPatientRows(): StoredRow[] {
  return fixedPatients().map((seed) => ({
    legacy_id: seed.legacyPatientId,
    full_name: seed.fullName ?? null,
    email: seed.email ?? null,
    dob: null,
    sex: null,
    bsn: null,
    phone: seed.phone ?? null,
    city: seed.city ?? null,
    weight: null,
    weight_unit: null,
    height_cm: null,
    status: null,
    signup_date: null,
    source: null,
    raw_data: seed.rawData,
  }));
}

describe('declining one rule row', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let patients: Repository<LegacyPatient>;
  let intakes: Repository<LegacyIntake>;
  let patientRules: Repository<LegacyPatientRule>;
  let intakeRules: Repository<LegacyIntakeRule>;
  let rules: Repository<Rule>;
  let versions: Repository<RuleVersion>;
  let ruleVersions: RuleVersionsService;
  let rowDeclines: RuleRowDeclinesService;

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
    await repository.insert(
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

  /** The press itself: the cross on one row, checkbox unticked (1.2.7). */
  async function declineRow(
    ruleId: string,
    body: unknown,
  ): Promise<{ status: number; body: DeclineRowResponse }> {
    const response = await request(app.getHttpServer())
      .post(`/rules/${ruleId}/rows/decline`)
      .send(body as object);

    return { status: response.status, body: response.body as DeclineRowResponse };
  }

  /** The tick on a whole rule, for the tests that prove the rule still works. */
  async function approveRule(ruleId: string): Promise<{ status: number; body: ApproveResponse }> {
    const response = await request(app.getHttpServer()).post(`/rules/${ruleId}/approve`);

    return { status: response.status, body: response.body as ApproveResponse };
  }

  /** The tick on one row. */
  async function approveRow(
    ruleId: string,
    body: unknown,
  ): Promise<{ status: number; body: ApproveResponse }> {
    const response = await request(app.getHttpServer())
      .post(`/rules/${ruleId}/rows/approve`)
      .send(body as object);

    return { status: response.status, body: response.body as ApproveResponse };
  }

  /** "Apply rules" (1.2.10), which is where a decline has to hold forever. */
  async function applyRules(): Promise<{ status: number; body: ApplyRulesResponse }> {
    const response = await request(app.getHttpServer()).post('/rules/apply');

    return { status: response.status, body: response.body as ApplyRulesResponse };
  }

  /** A rule table's rows, in an order no assertion depends on. */
  async function ruleRowsOf(repository: Repository<LegacyRuleRow>): Promise<LegacyRuleRow[]> {
    return await repository.find({
      order: { legacyId: 'ASC', ruleId: 'ASC', version: 'ASC', column: 'ASC' },
    });
  }

  /** `(legacyId, ruleId, version, column, status, reason)` of every rule row. */
  async function decisionsOf(repository: Repository<LegacyRuleRow>): Promise<unknown[][]> {
    return (await ruleRowsOf(repository)).map((row) => [
      row.legacyId,
      row.ruleId,
      row.version,
      row.column,
      row.status,
      row.reason,
    ]);
  }

  /** Every legacy patient as stored, minus the surrogate id nothing asserts on. */
  async function storedPatients(): Promise<StoredRow[]> {
    const rows = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    return rows.map((row) => {
      const withoutId = { ...row };

      delete withoutId.id;

      return withoutId;
    });
  }

  /** The one legacy patient carrying a legacy id. */
  async function patient(legacyPatientId: string): Promise<LegacyPatient> {
    const [row] = await patients.find({ where: { legacyPatientId } });

    if (row === undefined) {
      throw new Error(`no legacy patient ${legacyPatientId}`);
    }

    return row;
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // The catalogue ships empty on purpose, so the fakes arrive the way real
      // rules will: through the registry the runner injects.
      .overrideProvider(RuleRegistry)
      .useValue(new RuleRegistry(fakeRules))
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    // Booting is what creates the tables: `synchronize: true` and no migration
    // step to stand in for it (tech-stack 4.4).
    await app.init();
    dataSource = moduleRef.get(DataSource);
    patients = dataSource.getRepository(LegacyPatient);
    intakes = dataSource.getRepository(LegacyIntake);
    patientRules = dataSource.getRepository(LegacyPatientRule);
    intakeRules = dataSource.getRepository(LegacyIntakeRule);
    rules = dataSource.getRepository(Rule);
    versions = dataSource.getRepository(RuleVersion);
    ruleVersions = moduleRef.get(RuleVersionsService);
    rowDeclines = moduleRef.get(RuleRowDeclinesService);
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
    await patients.insert(fixedPatients());
    await intakes.insert(fixedIntakes());
  });

  it('declines every column one fix proposes on the row together (1.1.4)', async () => {
    await seedRule('R-TWO', [1], 1);
    await seedFindings(patientRules, [
      { legacyId: 'P-1', ruleId: 'R-TWO', column: 'weight', nextValue: '81.6' },
      { legacyId: 'P-1', ruleId: 'R-TWO', column: 'weight_unit', nextValue: 'kg' },
      { legacyId: 'P-2', ruleId: 'R-TWO', column: 'weight', nextValue: '70.0' },
    ]);

    const { body } = await declineRow('R-TWO', {
      table: 'patient',
      legacyId: 'P-1',
      version: 1,
      column: 'weight_unit',
      reason: 'already kilograms',
    });

    // Crossing out one column of a two-column fix crosses out the fix: half of
    // it declined and half still approvable would let half of it be applied.
    expect(body).toMatchObject({ ruleId: 'R-TWO', version: 1, declined: 2 });
    expect(await decisionsOf(patientRules)).toEqual([
      ['P-1', 'R-TWO', 1, 'weight', 'declined', 'already kilograms'],
      ['P-1', 'R-TWO', 1, 'weight_unit', 'declined', 'already kilograms'],
      ['P-2', 'R-TWO', 1, 'weight', 'pending', null],
    ]);
  });

  it('crosses the row out and stores the reason on it', async () => {
    await seedRule('R-CROSS', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0455',
        ruleId: 'R-CROSS',
        column: 'phone',
        previousValue: '0645500000',
        nextValue: '+31645500000',
      },
    ]);

    const { status, body } = await declineRow('R-CROSS', {
      table: 'patient',
      legacyId: 'P-0455',
      version: 1,
      column: 'phone',
      reason: 'that number is the practice, not the patient',
    });

    // 200 rather than the 201 a POST defaults to: nothing was created at a URL.
    expect(status).toBe(200);
    expect(body).toEqual({
      ruleId: 'R-CROSS',
      version: 1,
      declined: 1,
      reason: 'that number is the practice, not the patient',
    });

    // 1.2.7's first two Thens, read off the table rather than off the response:
    // the row's status is declined and the reason is stored on the rule row.
    // Nothing else about the finding moved — it is the modification log (1.3).
    const stored = await dataSource.query<StoredRow[]>(`SELECT * FROM legacy_patient_rule`);

    expect(stored).toEqual([
      {
        legacy_id: 'P-0455',
        rule_id: 'R-CROSS',
        version: 1,
        column: 'phone',
        previous_value: '0645500000',
        next_value: '+31645500000',
        status: 'declined',
        reason: 'that number is the practice, not the patient',
      },
    ]);
  });

  it('treats a missing, null or blank reason as no reason, and trims a padded one', async () => {
    await seedRule('R-REASONS', [1], 1);
    await seedFindings(patientRules, [
      { legacyId: 'P-0455', ruleId: 'R-REASONS', column: 'phone' },
      { legacyId: 'P-1', ruleId: 'R-REASONS', column: 'phone' },
      { legacyId: 'P-2', ruleId: 'R-REASONS', column: 'phone' },
      { legacyId: 'P-3', ruleId: 'R-REASONS', column: 'phone' },
    ]);

    const address = (legacyId: string): RowAddressBody => ({
      table: 'patient',
      legacyId,
      version: 1,
      column: 'phone',
    });

    const absent = await declineRow('R-REASONS', address('P-0455'));
    const nulled = await declineRow('R-REASONS', { ...address('P-1'), reason: null });
    const blank = await declineRow('R-REASONS', { ...address('P-2'), reason: '   ' });
    const padded = await declineRow('R-REASONS', {
      ...address('P-3'),
      reason: '  the city is not a typo  ',
    });

    // The reason is optional (1.2.7): a cross without one declines the row and
    // records nothing in its place. A reason of only whitespace is the same
    // press — a row holding " " would read as feedback the user typed — and the
    // padding around a real one is not part of what he wrote. Exactly how
    // `RuleVersionsService` already normalises a version's reason (1.2.6), so a
    // row's reason cannot come to mean something different.
    expect([absent.body, nulled.body, blank.body]).toEqual([
      { ruleId: 'R-REASONS', version: 1, declined: 1, reason: null },
      { ruleId: 'R-REASONS', version: 1, declined: 1, reason: null },
      { ruleId: 'R-REASONS', version: 1, declined: 1, reason: null },
    ]);
    expect(padded.body).toEqual({
      ruleId: 'R-REASONS',
      version: 1,
      declined: 1,
      reason: 'the city is not a typo',
    });

    expect(await decisionsOf(patientRules)).toEqual([
      ['P-0455', 'R-REASONS', 1, 'phone', 'declined', null],
      ['P-1', 'R-REASONS', 1, 'phone', 'declined', null],
      ['P-2', 'R-REASONS', 1, 'phone', 'declined', null],
      ['P-3', 'R-REASONS', 1, 'phone', 'declined', 'the city is not a typo'],
    ]);
  });

  it('leaves the rule and its version exactly as they were', async () => {
    await seedRule('R-UNTOUCHED', [1, 2], 2);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0455',
        ruleId: 'R-UNTOUCHED',
        version: 2,
        column: 'phone',
        previousValue: '0645500000',
        nextValue: '+31645500000',
      },
    ]);

    await declineRow('R-UNTOUCHED', {
      table: 'patient',
      legacyId: 'P-0455',
      version: 2,
      column: 'phone',
      reason: 'this one patient only',
    });

    // "Rule R7 is untouched" (1.2.7), byte for byte. The active version is
    // still active, so the rule stays on the screen (1.2.1) and keeps running
    // on the next press of Apply rules; `needs_review` is still false, so the
    // revision workflow (1.5.1) is not handed a rule nobody asked it to revise;
    // and the reason went on the row, not on the version. That last point is
    // the whole difference between this press and the ticked cross (1.2.8).
    expect(
      await dataSource.query<StoredRow[]>(
        `SELECT * FROM rule_version WHERE rule_id = 'R-UNTOUCHED' ORDER BY version`,
      ),
    ).toEqual([
      { rule_id: 'R-UNTOUCHED', version: 1, status: 'inactive', needs_review: 0, reason: null },
      { rule_id: 'R-UNTOUCHED', version: 2, status: 'active', needs_review: 0, reason: null },
    ]);

    expect(await rules.findOneOrFail({ where: { ruleId: 'R-UNTOUCHED' } })).toEqual({
      ruleId: 'R-UNTOUCHED',
      ruleName: 'R-UNTOUCHED name',
      description: 'R-UNTOUCHED description',
      ambiguous: false,
    });
  });

  it('leaves the rule’s other rows approvable, and the crossed-out one alone', async () => {
    await seedRule('R-OTHERS', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0455',
        ruleId: 'R-OTHERS',
        column: 'phone',
        previousValue: '0645500000',
        nextValue: '+31645500000',
      },
      {
        legacyId: 'P-1',
        ruleId: 'R-OTHERS',
        column: 'phone',
        previousValue: '0611111111',
        nextValue: '+31611111111',
      },
      {
        legacyId: 'P-2',
        ruleId: 'R-OTHERS',
        column: 'phone',
        previousValue: '0622222222',
        nextValue: '+31622222222',
      },
    ]);

    await declineRow('R-OTHERS', {
      table: 'patient',
      legacyId: 'P-0455',
      version: 1,
      column: 'phone',
      reason: 'wrong on this one row',
    });

    const { body } = await approveRule('R-OTHERS');

    // "Its other rows stay approvable" (1.2.7), proved against the real approve
    // path rather than by inspection: the rule-level tick takes what is still
    // pending, which is everything but the row that was crossed out.
    expect(body).toEqual({ ruleId: 'R-OTHERS', version: 1, approved: 2, updated: 2 });
    expect((await patient('P-1')).phone).toBe('+31611111111');
    expect((await patient('P-2')).phone).toBe('+31622222222');
    // And the declined row is still declined, with its own reason and its
    // patient's column untouched — an approve can never revive it (1.2.11).
    expect((await patient('P-0455')).phone).toBe('0645500000');
    expect(await decisionsOf(patientRules)).toEqual([
      ['P-0455', 'R-OTHERS', 1, 'phone', 'declined', 'wrong on this one row'],
      ['P-1', 'R-OTHERS', 1, 'phone', 'approved', null],
      ['P-2', 'R-OTHERS', 1, 'phone', 'approved', null],
    ]);
  });

  it('is never proposed again, not even by a later version of the rule', async () => {
    await seedRule('R-FOREVER', [1, 2], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0455',
        ruleId: 'R-FOREVER',
        column: 'phone',
        previousValue: '0645500000',
        nextValue: '+31645500000',
      },
    ]);

    const crossed = await declineRow('R-FOREVER', {
      table: 'patient',
      legacyId: 'P-0455',
      version: 1,
      column: 'phone',
      reason: 'the patient asked us to leave it alone',
    });

    expect(crossed.body.declined).toBe(1);

    // The revision workflow's end of it (1.5.1): version 2 is now the active
    // code, and it proposes on every patient the old one did.
    await ruleVersions.activate('R-FOREVER', 2);

    const { status, body } = await applyRules();

    // 1.2.9, from a decline this endpoint actually wrote rather than a seeded
    // one: the run finds all three matching patients and the shared API drops
    // the declined one, because the decline is looked up by
    // (legacyId, ruleId, column) and the version is no part of that check.
    expect(status).toBe(200);
    expect(body.rules).toEqual([
      {
        ruleId: 'R-FOREVER',
        version: 2,
        found: 3,
        declined: 1,
        repeated: 0,
        written: 2,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);

    // No pending row for P-0455 under version 2 — the row a human crossed out
    // never comes back to the screen (1.2.1) — while the other two matching
    // patients do get one, so the rule itself is plainly still working.
    expect(await decisionsOf(patientRules)).toEqual([
      ['P-0455', 'R-FOREVER', 1, 'phone', 'declined', 'the patient asked us to leave it alone'],
      ['P-1', 'R-FOREVER', 2, 'phone', 'pending', null],
      ['P-2', 'R-FOREVER', 2, 'phone', 'pending', null],
    ]);
  });

  it('writes nothing to the legacy data', async () => {
    await seedRule('R-NO-DATA', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0455',
        ruleId: 'R-NO-DATA',
        column: 'phone',
        previousValue: '0645500000',
        nextValue: '+31645500000',
      },
    ]);

    await declineRow('R-NO-DATA', {
      table: 'patient',
      legacyId: 'P-0455',
      version: 1,
      column: 'phone',
      reason: 'leave the number as it is',
    });

    // The cross records a decision and nothing else. It does not apply the
    // change, and it does not revert one — there is nothing to revert, because
    // a pending row was never applied (1.2.5). Every column of every patient,
    // so a write to a neighbouring column or row would show up here.
    expect(await storedPatients()).toEqual(seededPatientRows());
  });

  it('declines nothing when the row is already decided, or is not there', async () => {
    await seedRule('R-STALE', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0455',
        ruleId: 'R-STALE',
        column: 'phone',
        previousValue: '0645500000',
        nextValue: '+31645500000',
      },
      {
        legacyId: 'P-1',
        ruleId: 'R-STALE',
        column: 'phone',
        previousValue: '0611111111',
        nextValue: '+31611111111',
        status: 'approved',
      },
    ]);

    const first = await declineRow('R-STALE', {
      table: 'patient',
      legacyId: 'P-0455',
      version: 1,
      column: 'phone',
      reason: 'the first reason',
    });
    const second = await declineRow('R-STALE', {
      table: 'patient',
      legacyId: 'P-0455',
      version: 1,
      column: 'phone',
      reason: 'the second reason',
    });
    const settled = await declineRow('R-STALE', {
      table: 'patient',
      legacyId: 'P-1',
      version: 1,
      column: 'phone',
      reason: 'too late',
    });
    const absent = await declineRow('R-STALE', {
      table: 'patient',
      legacyId: 'P-NOBODY',
      version: 1,
      column: 'phone',
      reason: 'a row no rule table holds',
    });

    // A press with nothing to act on is a count rather than a fault, for an
    // operator pressing from a screen that may be a moment stale (1.2.12).
    expect(first.body).toEqual({
      ruleId: 'R-STALE',
      version: 1,
      declined: 1,
      reason: 'the first reason',
    });
    expect([second.status, settled.status, absent.status]).toEqual([200, 200, 200]);
    expect([second.body, settled.body, absent.body]).toEqual([
      { ruleId: 'R-STALE', version: 1, declined: 0, reason: null },
      { ruleId: 'R-STALE', version: 1, declined: 0, reason: null },
      { ruleId: 'R-STALE', version: 1, declined: 0, reason: null },
    ]);

    // Every one of those three presses is inert. The declined row keeps the
    // reason the decline that actually happened gave it, the approved row is
    // still approved (1.2.11), and nothing was invented for the address that
    // does not exist.
    expect(await decisionsOf(patientRules)).toEqual([
      ['P-0455', 'R-STALE', 1, 'phone', 'declined', 'the first reason'],
      ['P-1', 'R-STALE', 1, 'phone', 'approved', null],
    ]);
    expect(await storedPatients()).toEqual(seededPatientRows());
  });

  it('declines nothing for a source table that does not exist', async () => {
    await seedRule('R-NO-SOURCE', [1], 1);
    await seedFindings(patientRules, [
      { legacyId: 'P-0455', ruleId: 'R-NO-SOURCE', column: 'phone' },
    ]);

    // Straight at the service, because the endpoint answers 400 for a table
    // that is not one of the three — the test below proves that. The service
    // still has to answer for itself: it is the shared write path (1.1.3), and
    // a press it cannot place must write nothing rather than throw or guess a
    // table.
    const report = await rowDeclines.declineRow(
      {
        table: 'prescription',
        legacyId: 'P-0455',
        ruleId: 'R-NO-SOURCE',
        version: 1,
        column: 'phone',
      },
      'a source we do not have',
    );

    expect(report).toEqual({ ruleId: 'R-NO-SOURCE', version: 1, declined: 0, reason: null });
    expect(await decisionsOf(patientRules)).toEqual([
      ['P-0455', 'R-NO-SOURCE', 1, 'phone', 'pending', null],
    ]);
  });

  it('declines nothing when the request itself is malformed', async () => {
    await seedRule('R-MALFORMED', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0455',
        ruleId: 'R-MALFORMED',
        column: 'phone',
        previousValue: '0645500000',
        nextValue: '+31645500000',
      },
    ]);

    const address: RowAddressBody = {
      table: 'patient',
      legacyId: 'P-0455',
      version: 1,
      column: 'phone',
    };

    const numericReason = await declineRow('R-MALFORMED', { ...address, reason: 7 });
    const noLegacyId = await declineRow('R-MALFORMED', {
      table: 'patient',
      version: 1,
      column: 'phone',
    });
    const versionAsText = await declineRow('R-MALFORMED', { ...address, version: '1' });
    const pluralTable = await declineRow('R-MALFORMED', { ...address, table: 'patients' });
    const noBody = await declineRow('R-MALFORMED', undefined);

    // A caller's mistake is the one thing that is a 400 here, and it declines
    // nothing: half a decline, or a row carrying a coerced reason that later
    // reads like feedback, would both be worse than the press failing.
    expect([
      numericReason.status,
      noLegacyId.status,
      versionAsText.status,
      pluralTable.status,
      noBody.status,
    ]).toEqual([400, 400, 400, 400, 400]);

    expect(await decisionsOf(patientRules)).toEqual([
      ['P-0455', 'R-MALFORMED', 1, 'phone', 'pending', null],
    ]);
  });

  it('declines the row of one rule, not every rule at that legacy id and column', async () => {
    await seedRule('R-SCOPE-A', [1, 2], 1);
    await seedRule('R-SCOPE-B', [1, 2], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-1',
        ruleId: 'R-SCOPE-A',
        column: 'phone',
        previousValue: '0611111111',
        nextValue: '+31611111111',
      },
      {
        legacyId: 'P-1',
        ruleId: 'R-SCOPE-B',
        column: 'phone',
        previousValue: '0611111111',
        nextValue: '0031611111111',
      },
    ]);

    await declineRow('R-SCOPE-A', {
      table: 'patient',
      legacyId: 'P-1',
      version: 1,
      column: 'phone',
      reason: 'rule A is wrong about this patient',
    });

    // The decline is scoped by (legacyId, ruleId, column) — it is a decision
    // about one rule's proposal, not about the data row (1.2.9).
    expect(await decisionsOf(patientRules)).toEqual([
      ['P-1', 'R-SCOPE-A', 1, 'phone', 'declined', 'rule A is wrong about this patient'],
      ['P-1', 'R-SCOPE-B', 1, 'phone', 'pending', null],
    ]);

    await ruleVersions.activate('R-SCOPE-A', 2);
    await ruleVersions.activate('R-SCOPE-B', 2);

    const { body } = await applyRules();

    // A later run makes the same point where it counts: rule A is blocked at
    // P-1 and rule B is not, at the identical legacy id and column.
    expect(body.rules).toEqual([
      {
        ruleId: 'R-SCOPE-A',
        version: 2,
        found: 3,
        declined: 1,
        repeated: 0,
        written: 2,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
      {
        ruleId: 'R-SCOPE-B',
        version: 2,
        found: 3,
        declined: 0,
        repeated: 0,
        written: 3,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);

    const afterRun = await decisionsOf(patientRules);

    expect(afterRun).toContainEqual(['P-1', 'R-SCOPE-B', 2, 'phone', 'pending', null]);
    expect(afterRun).not.toContainEqual(['P-1', 'R-SCOPE-A', 2, 'phone', 'pending', null]);
    expect(afterRun.filter((row) => row[0] === 'P-1' && row[1] === 'R-SCOPE-A')).toEqual([
      ['P-1', 'R-SCOPE-A', 1, 'phone', 'declined', 'rule A is wrong about this patient'],
    ]);

    // And rule B's own row is still approvable at that address, which is the
    // other half of "the rule is untouched" (1.2.7) seen from the next rule
    // along: one rule's cross settles nothing for anybody else.
    const approved = await approveRow('R-SCOPE-B', {
      table: 'patient',
      legacyId: 'P-1',
      version: 1,
      column: 'phone',
    });

    expect(approved.body).toEqual({ ruleId: 'R-SCOPE-B', version: 1, approved: 1, updated: 1 });
    expect((await patient('P-1')).phone).toBe('0031611111111');
  });

  it('crosses out an intake row without touching the patient row at the same address', async () => {
    await seedRule('R-SOURCES', [1], 1);
    await seedFindings(intakeRules, [
      {
        legacyId: 'I-1',
        ruleId: 'R-SOURCES',
        column: 'outcome',
        previousValue: 'ok',
        nextValue: 'accepted',
      },
    ]);
    // The same four-part key in the other rule table, so only the `table` field
    // of the request can tell the two presses apart.
    await seedFindings(patientRules, [
      {
        legacyId: 'I-1',
        ruleId: 'R-SOURCES',
        column: 'outcome',
        previousValue: 'ok',
        nextValue: 'accepted',
      },
    ]);

    const { body } = await declineRow('R-SOURCES', {
      table: 'intake',
      legacyId: 'I-1',
      version: 1,
      column: 'outcome',
      reason: 'the reviewer never signed this one off',
    });

    // 1.1.7's finding names its own source table, and the press has to be
    // routed by it: the intake row is declined and the patient row at the
    // identical key is left exactly as the run wrote it.
    expect(body).toEqual({
      ruleId: 'R-SOURCES',
      version: 1,
      declined: 1,
      reason: 'the reviewer never signed this one off',
    });
    expect(await decisionsOf(intakeRules)).toEqual([
      ['I-1', 'R-SOURCES', 1, 'outcome', 'declined', 'the reviewer never signed this one off'],
    ]);
    expect(await decisionsOf(patientRules)).toEqual([
      ['I-1', 'R-SOURCES', 1, 'outcome', 'pending', null],
    ]);
    expect(await intakes.findOneOrFail({ where: { legacyIntakeId: 'I-1' } })).toMatchObject({
      outcome: 'ok',
    });
  });
});
