import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import type { ApproveResponse } from '../src/approve/approve.controller';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import {
  LegacyIntakeRule,
  LegacyPatientRule,
  type LegacyRuleRow,
  type LegacyRuleStatus,
} from '../src/legacy/legacy-rule.entity';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * Approving, at both levels (1.2.4), over HTTP and against a real database.
 *
 * No rules and no registry override anywhere in this suite: approving runs no
 * rule. What it acts on is rule rows, which are what a run left behind, so
 * every fixture is seeded straight through the repositories — the same way
 * `rule-findings.spec.ts` seeds the decisions it has to read.
 *
 * Nothing here asserts that a service was called. Every assertion is about what
 * the legacy data table and the rule table hold once the response came back,
 * because that pair is the whole of 1.2.5: the status and the column land or
 * fail together, and a test that watched a call could not tell the difference.
 *
 * Each test uses rule ids of its own, so no test's active version can be picked
 * up by another's press.
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

/**
 * The patients every test starts from.
 *
 * A function rather than a constant, because inserting writes the generated id
 * back into the object it was handed, and a shared object carrying a stale id
 * would be updated instead of inserted on the next test.
 */
function fixedPatients(): PatientSeed[] {
  return [
    {
      legacyPatientId: 'P-1',
      fullName: 'Ana de Vries',
      email: 'ana@old.example',
      phone: '0612345678',
      city: 'Utrecht',
      rawData: '{"id":"P-1","phone":"0612345678"}',
    },
    {
      legacyPatientId: 'P-2',
      fullName: 'Bram Jansen',
      email: 'bram@old.example',
      phone: '+31612345679',
      city: 'Amsterdam',
      rawData: '{"id":"P-2"}',
    },
    {
      legacyPatientId: 'P-3',
      fullName: 'Cas Bakker',
      email: 'cas@new.example',
      phone: '0698765432',
      city: 'Rotterdam',
      rawData: '{"id":"P-3"}',
    },
    {
      legacyPatientId: 'P-4',
      fullName: 'Dee Smit',
      email: 'dee@old.example',
      phone: null,
      city: 'Den Haag',
      rawData: '{"id":"P-4"}',
    },
  ];
}

/** Two intakes, so a press across two sources has a second source to reach. */
function fixedIntakes(): { legacyIntakeId: string; outcome: string; rawData: string }[] {
  return [
    { legacyIntakeId: 'I-1', outcome: 'ok', rawData: '{"id":"I-1"}' },
    { legacyIntakeId: 'I-2', outcome: 'ok', rawData: '{"id":"I-2"}' },
  ];
}

describe('approving rule rows', () => {
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

  /** Rule rows a run would have written. Chunked, for SQLite's parameter limit. */
  async function seedFindings(
    repository: Repository<LegacyRuleRow>,
    rows: FindingSeed[],
  ): Promise<void> {
    const complete = rows.map((row) => ({
      version: 1,
      previousValue: null,
      nextValue: null,
      status: 'pending' as LegacyRuleStatus,
      reason: null,
      ...row,
    }));

    for (let start = 0; start < complete.length; start += 50) {
      await repository.insert(complete.slice(start, start + 50));
    }
  }

  /** Chunked, so a hundred seed rows stay inside SQLite's parameter limit. */
  async function insertPatients(rows: PatientSeed[]): Promise<void> {
    for (let start = 0; start < rows.length; start += 50) {
      await patients.insert(rows.slice(start, start + 50));
    }
  }

  /** The rule-level press: every pending row of the active version (1.2.4). */
  async function approveRule(ruleId: string): Promise<{ status: number; body: ApproveResponse }> {
    const response = await request(app.getHttpServer()).post(`/rules/${ruleId}/approve`);

    return { status: response.status, body: response.body as ApproveResponse };
  }

  /** The row-level press: one rule row, addressed by its primary key. */
  async function approveRow(
    ruleId: string,
    body: unknown,
  ): Promise<{ status: number; body: ApproveResponse }> {
    const response = await request(app.getHttpServer())
      .post(`/rules/${ruleId}/rows/approve`)
      .send(body as object);

    return { status: response.status, body: response.body as ApproveResponse };
  }

  /** The one legacy patient carrying a legacy id, for the fixtures that have one. */
  async function patient(legacyPatientId: string): Promise<LegacyPatient> {
    const [row] = await patients.find({ where: { legacyPatientId } });

    if (row === undefined) {
      throw new Error(`no legacy patient ${legacyPatientId}`);
    }

    return row;
  }

  /** A rule table's rows, in an order no assertion depends on. */
  async function ruleRowsOf(repository: Repository<LegacyRuleRow>): Promise<LegacyRuleRow[]> {
    return await repository.find({
      order: { legacyId: 'ASC', ruleId: 'ASC', version: 'ASC', column: 'ASC' },
    });
  }

  /** `(legacyId, version, column) -> status`, which is what most assertions here are. */
  async function statusesOf(repository: Repository<LegacyRuleRow>): Promise<string[][]> {
    return (await ruleRowsOf(repository)).map((row) => [
      row.legacyId,
      String(row.version),
      row.column,
      row.status,
    ]);
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    // Several tests deliberately fail a press, and Nest logs the stack of any
    // non-HTTP exception it turns into a 500. Silenced so a passing run's
    // output holds no stack trace that looks like a failure.
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
    await insertPatients(fixedPatients());
    await intakes.insert(fixedIntakes());
  });

  it('moves every pending row of the active version and writes each column', async () => {
    await seedRule('R-BOTH', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-1',
        ruleId: 'R-BOTH',
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
      },
      {
        legacyId: 'P-2',
        ruleId: 'R-BOTH',
        column: 'full_name',
        previousValue: 'Bram Jansen',
        nextValue: 'Bram Jansen-Smit',
      },
    ]);
    await seedFindings(intakeRules, [
      {
        legacyId: 'I-1',
        ruleId: 'R-BOTH',
        column: 'outcome',
        previousValue: 'ok',
        nextValue: 'accepted',
      },
    ]);

    const { status, body } = await approveRule('R-BOTH');

    // 200 rather than the 201 a POST defaults to: nothing was created at a URL.
    expect(status).toBe(200);
    expect(body).toEqual({ ruleId: 'R-BOTH', version: 1, approved: 3, updated: 3 });

    // The data changed, in two tables and on two different columns (1.2.4,
    // first scenario) — and only on the columns the findings named.
    expect(await patient('P-1')).toMatchObject({ phone: '+31612345678', fullName: 'Ana de Vries' });
    expect(await patient('P-2')).toMatchObject({
      fullName: 'Bram Jansen-Smit',
      phone: '+31612345679',
    });
    expect(await intakes.find({ where: { legacyIntakeId: 'I-1' } })).toMatchObject([
      { outcome: 'accepted' },
    ]);
    // The second intake was never named by a finding, so it is untouched.
    expect(await intakes.find({ where: { legacyIntakeId: 'I-2' } })).toMatchObject([
      { outcome: 'ok' },
    ]);

    // And every rule row moved with the data it describes (1.2.5).
    expect(await statusesOf(patientRules)).toEqual([
      ['P-1', '1', 'phone', 'approved'],
      ['P-2', '1', 'full_name', 'approved'],
    ]);
    expect(await statusesOf(intakeRules)).toEqual([['I-1', '1', 'outcome', 'approved']]);
  });

  it('leaves the approved row saying which rule at which version changed what', async () => {
    await seedRule('R-LOG', [1, 2, 3], 3);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-1',
        ruleId: 'R-LOG',
        version: 3,
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
      },
    ]);

    await approveRule('R-LOG');

    // 1.3: the rule row is the modification log, written by the same
    // transaction that changed the data. Nothing about the finding is lost when
    // it is applied — the rule, the version that proposed it, the column, and
    // both values are all still there beside the new status.
    const stored = await dataSource.query<StoredRow[]>(`SELECT * FROM legacy_patient_rule`);

    expect(stored).toEqual([
      {
        legacy_id: 'P-1',
        rule_id: 'R-LOG',
        version: 3,
        column: 'phone',
        previous_value: '0612345678',
        next_value: '+31612345678',
        status: 'approved',
        reason: null,
      },
    ]);
    expect((await patient('P-1')).phone).toBe('+31612345678');
  });

  it('takes only what is still pending, and does not rewrite an approved row', async () => {
    await seedRule('R-PARTIAL', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-1',
        ruleId: 'R-PARTIAL',
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
      },
      // Decided earlier, and deliberately never written to the data by this
      // fixture: if the press re-applied it, the email below would change.
      {
        legacyId: 'P-2',
        ruleId: 'R-PARTIAL',
        column: 'email',
        previousValue: 'bram@old.example',
        nextValue: 'bram@new.example',
        status: 'approved',
      },
    ]);

    const { body } = await approveRule('R-PARTIAL');

    // 1.2.4, third scenario: the pending row moves, the already-approved one is
    // untouched — its status and its data both.
    expect(body).toEqual({ ruleId: 'R-PARTIAL', version: 1, approved: 1, updated: 1 });
    expect((await patient('P-1')).phone).toBe('+31612345678');
    expect((await patient('P-2')).email).toBe('bram@old.example');
    expect(await statusesOf(patientRules)).toEqual([
      ['P-1', '1', 'phone', 'approved'],
      ['P-2', '1', 'email', 'approved'],
    ]);
  });

  it('never touches a declined row', async () => {
    await seedRule('R-CROSS', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-1',
        ruleId: 'R-CROSS',
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
      },
      {
        legacyId: 'P-3',
        ruleId: 'R-CROSS',
        column: 'phone',
        previousValue: '0698765432',
        nextValue: '+31698765432',
        status: 'declined',
        reason: 'that number is the practice, not the patient',
      },
    ]);

    const { body } = await approveRule('R-CROSS');

    // 1.2.7: crossing a row out settles it forever, so a later rule-level
    // approve cannot quietly apply it after all.
    expect(body).toEqual({ ruleId: 'R-CROSS', version: 1, approved: 1, updated: 1 });
    expect((await patient('P-3')).phone).toBe('0698765432');

    const declined = (await ruleRowsOf(patientRules)).find((row) => row.legacyId === 'P-3');

    expect(declined).toMatchObject({
      status: 'declined',
      reason: 'that number is the practice, not the patient',
    });
  });

  it('approves one row and leaves the rule’s other rows pending', async () => {
    await seedRule('R-ROW', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-1',
        ruleId: 'R-ROW',
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
      },
      {
        legacyId: 'P-2',
        ruleId: 'R-ROW',
        column: 'email',
        previousValue: 'bram@old.example',
        nextValue: 'bram@new.example',
      },
      {
        legacyId: 'P-3',
        ruleId: 'R-ROW',
        column: 'phone',
        previousValue: '0698765432',
        nextValue: '+31698765432',
      },
    ]);

    const { status, body } = await approveRow('R-ROW', {
      table: 'patient',
      legacyId: 'P-2',
      version: 1,
      column: 'email',
    });

    // 1.2.4, second scenario: only that row moves and only that patient's
    // column is written.
    expect(status).toBe(200);
    expect(body).toEqual({ ruleId: 'R-ROW', version: 1, approved: 1, updated: 1 });
    expect((await patient('P-2')).email).toBe('bram@new.example');
    expect((await patient('P-1')).phone).toBe('0612345678');
    expect((await patient('P-3')).phone).toBe('0698765432');
    expect(await statusesOf(patientRules)).toEqual([
      ['P-1', '1', 'phone', 'pending'],
      ['P-2', '1', 'email', 'approved'],
      ['P-3', '1', 'phone', 'pending'],
    ]);
  });

  it('applies nothing at all when a rule-level press fails part-way through', async () => {
    await insertPatients([
      {
        legacyPatientId: 'P-BOOM',
        fullName: 'Eef Mulder',
        email: 'eef@old.example',
        phone: '0600000000',
        city: 'Breda',
        rawData: '{"id":"P-BOOM"}',
      },
    ]);
    await seedRule('R-BOOM', [1], 1);
    await seedFindings(patientRules, [
      // Applied first — "P-1" sorts before "P-BOOM" — so the second write
      // aborts with one write already issued, which is the case 1.2.5 is about.
      {
        legacyId: 'P-1',
        ruleId: 'R-BOOM',
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
      },
      {
        legacyId: 'P-BOOM',
        ruleId: 'R-BOOM',
        column: 'phone',
        previousValue: '0600000000',
        nextValue: '+31600000000',
      },
    ]);

    // A real failure inside the database rather than a simulated one: the
    // update of the second row is refused by SQLite itself.
    await dataSource.query(
      `CREATE TRIGGER boom BEFORE UPDATE ON legacy_patient
       WHEN NEW.legacy_id = 'P-BOOM'
       BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );

    try {
      const { status } = await approveRule('R-BOOM');

      expect(status).toBe(500);
    } finally {
      await dataSource.query(`DROP TRIGGER boom`);
    }

    // 1.2.5: if either write fails, neither is applied. The first patient's
    // phone was already written when the second row blew up, and the rollback
    // took it back with everything else.
    expect((await patient('P-1')).phone).toBe('0612345678');
    expect((await patient('P-BOOM')).phone).toBe('0600000000');
    expect(await statusesOf(patientRules)).toEqual([
      ['P-1', '1', 'phone', 'pending'],
      ['P-BOOM', '1', 'phone', 'pending'],
    ]);
  });

  it('takes back the column when a row-level status flip fails after it', async () => {
    await seedRule('R-ROW-BOOM', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-1',
        ruleId: 'R-ROW-BOOM',
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
      },
    ]);

    // The trigger is on the *rule* table, not the data table, and that is the
    // point of this test. A press writes the column first and flips the status
    // second, so a failure on the data write proves nothing about the
    // transaction — the status flip is simply never reached. This is the other
    // direction: the column was written and committed to, and the write that
    // records it as approved is the one SQLite refuses. Without one transaction
    // around the pair the patient would be carrying a new phone number that no
    // rule row claims (1.2.5, 1.3).
    await dataSource.query(
      `CREATE TRIGGER boom BEFORE UPDATE ON legacy_patient_rule
       WHEN NEW.rule_id = 'R-ROW-BOOM'
       BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );

    try {
      const { status } = await approveRow('R-ROW-BOOM', {
        table: 'patient',
        legacyId: 'P-1',
        version: 1,
        column: 'phone',
      });

      expect(status).toBe(500);
    } finally {
      await dataSource.query(`DROP TRIGGER boom`);
    }

    expect((await patient('P-1')).phone).toBe('0612345678');
    expect(await statusesOf(patientRules)).toEqual([['P-1', '1', 'phone', 'pending']]);
  });

  it('acts on the active version, leaving an older version’s rows pending', async () => {
    await seedRule('R-VERSIONS', [1, 2], 2);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-1',
        ruleId: 'R-VERSIONS',
        version: 1,
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '0031612345678',
      },
      {
        legacyId: 'P-3',
        ruleId: 'R-VERSIONS',
        version: 2,
        column: 'phone',
        previousValue: '0698765432',
        nextValue: '+31698765432',
      },
    ]);

    const { body } = await approveRule('R-VERSIONS');

    // The rules screen shows the active version's pending rows (1.2.1), so the
    // press clears exactly those — and the log records the version that
    // actually proposed the change (1.3), which version 1's value would not.
    expect(body).toEqual({ ruleId: 'R-VERSIONS', version: 2, approved: 1, updated: 1 });
    expect((await patient('P-3')).phone).toBe('+31698765432');
    expect((await patient('P-1')).phone).toBe('0612345678');
    expect(await statusesOf(patientRules)).toEqual([
      ['P-1', '1', 'phone', 'pending'],
      ['P-3', '2', 'phone', 'approved'],
    ]);
  });

  it('approves nothing for a rule with no active version, or none at all', async () => {
    await seedRule('R-PARKED', [1]);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-1',
        ruleId: 'R-PARKED',
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
      },
    ]);

    const parked = await approveRule('R-PARKED');
    const missing = await approveRule('R-NOWHERE');

    // Declining a rule leaves it in exactly this state (1.2.6), waiting on the
    // revision workflow (1.5.1). There is no version for the press to act on,
    // so the inactive version's row stays pending rather than being applied by
    // a press that could not name it.
    expect(parked.body).toEqual({ ruleId: 'R-PARKED', version: null, approved: 0, updated: 0 });
    expect(missing.body).toEqual({ ruleId: 'R-NOWHERE', version: null, approved: 0, updated: 0 });
    expect((await patient('P-1')).phone).toBe('0612345678');
    expect(await statusesOf(patientRules)).toEqual([['P-1', '1', 'phone', 'pending']]);
  });

  it('reports zeroes when the active version has nothing pending', async () => {
    await seedRule('R-QUIET', [1], 1);

    const { status, body } = await approveRule('R-QUIET');

    // Nothing pending is a state, not a fault: the rule simply is not on the
    // screen (1.2.1).
    expect(status).toBe(200);
    expect(body).toEqual({ ruleId: 'R-QUIET', version: 1, approved: 0, updated: 0 });
  });

  it('approves nothing for a row that is settled, or that is not there', async () => {
    await seedRule('R-FINAL', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-1',
        ruleId: 'R-FINAL',
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
        status: 'approved',
      },
      {
        legacyId: 'P-3',
        ruleId: 'R-FINAL',
        column: 'phone',
        previousValue: '0698765432',
        nextValue: '+31698765432',
        status: 'declined',
        reason: 'junk number',
      },
    ]);

    const approved = await approveRow('R-FINAL', {
      table: 'patient',
      legacyId: 'P-1',
      version: 1,
      column: 'phone',
    });
    const declined = await approveRow('R-FINAL', {
      table: 'patient',
      legacyId: 'P-3',
      version: 1,
      column: 'phone',
    });
    // The rule has a row for P-1, but on another column entirely.
    const absent = await approveRow('R-FINAL', {
      table: 'patient',
      legacyId: 'P-1',
      version: 1,
      column: 'email',
    });

    // Acceptance is final (1.2.11) and a declined row stays declined (1.2.7),
    // so a press on either moves nothing — and neither does one on an address
    // no rule table holds. Each says so in its count rather than by looking
    // like work that happened.
    expect(approved.body).toEqual({ ruleId: 'R-FINAL', version: 1, approved: 0, updated: 0 });
    expect(declined.body).toEqual({ ruleId: 'R-FINAL', version: 1, approved: 0, updated: 0 });
    expect(absent.body).toEqual({ ruleId: 'R-FINAL', version: 1, approved: 0, updated: 0 });
    expect(await patient('P-1')).toMatchObject({
      phone: '0612345678',
      email: 'ana@old.example',
    });
    expect((await patient('P-3')).phone).toBe('0698765432');
    expect(await statusesOf(patientRules)).toEqual([
      ['P-1', '1', 'phone', 'approved'],
      ['P-3', '1', 'phone', 'declined'],
    ]);
  });

  it('refuses a finding that proposes no value, at either level', async () => {
    await seedRule('R-AMBIGUOUS', [1], 1);
    await seedFindings(patientRules, [
      // What an ambiguous rule produces (1.1.12): a problem it cannot fix.
      {
        legacyId: 'P-1',
        ruleId: 'R-AMBIGUOUS',
        column: 'phone',
        previousValue: '0612345678',
        nextValue: null,
      },
      {
        legacyId: 'P-3',
        ruleId: 'R-AMBIGUOUS',
        column: 'phone',
        previousValue: '0698765432',
        nextValue: '+31698765432',
      },
    ]);

    const wholeRule = await approveRule('R-AMBIGUOUS');
    const oneRow = await approveRow('R-AMBIGUOUS', {
      table: 'patient',
      legacyId: 'P-1',
      version: 1,
      column: 'phone',
    });

    // Applying it would erase the previous value the screen is showing the
    // human (1.2.3) with no undo to get it back (1.2.11). The rule-level press
    // fails whole, so the applicable row beside it is not applied either.
    expect(wholeRule.status).toBe(500);
    expect(oneRow.status).toBe(500);
    expect((await patient('P-1')).phone).toBe('0612345678');
    expect((await patient('P-3')).phone).toBe('0698765432');
    expect(await statusesOf(patientRules)).toEqual([
      ['P-1', '1', 'phone', 'pending'],
      ['P-3', '1', 'phone', 'pending'],
    ]);
  });

  it('writes a value supplied for an ambiguous finding only with a note, and keeps the note', async () => {
    await seedRule('R-TYPED', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-1',
        ruleId: 'R-TYPED',
        column: 'phone',
        previousValue: '0612345678',
        nextValue: null,
      },
    ]);

    const address = { table: 'patient', legacyId: 'P-1', version: 1, column: 'phone' };

    // No rule proposed this value, so without a note nothing would explain it
    // (1.2.13). A note with no value has nothing to explain.
    const noNote = await approveRow('R-TYPED', { ...address, value: '+31612345678' });
    const blankNote = await approveRow('R-TYPED', { ...address, value: '+31612345678', note: ' ' });
    const noteAlone = await approveRow('R-TYPED', { ...address, note: 'nothing to explain' });

    expect([noNote.status, blankNote.status, noteAlone.status]).toEqual([400, 400, 400]);
    expect((await patient('P-1')).phone).toBe('0612345678');

    const noted = await approveRow('R-TYPED', {
      ...address,
      value: '+31612345678',
      note: ' Confirmed on the phone ',
    });

    expect(noted.status).toBe(200);
    expect(noted.body).toMatchObject({ ruleId: 'R-TYPED', version: 1, approved: 1 });
    expect((await patient('P-1')).phone).toBe('+31612345678');
    expect(
      await patientRules.findOneBy({ legacyId: 'P-1', ruleId: 'R-TYPED', column: 'phone' }),
    ).toMatchObject({
      status: 'approved',
      nextValue: '+31612345678',
      reason: 'Confirmed on the phone',
    });
  });

  it('refuses a finding whose legacy id matches no legacy row', async () => {
    await seedRule('R-GHOST', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-NOBODY',
        ruleId: 'R-GHOST',
        column: 'phone',
        previousValue: '0611111111',
        nextValue: '+31611111111',
      },
      {
        legacyId: 'P-1',
        ruleId: 'R-GHOST',
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
      },
    ]);

    const { status } = await approveRule('R-GHOST');

    // An approved rule row can never claim a change that did not happen (1.3),
    // so the press fails rather than marking the ghost approved.
    expect(status).toBe(500);
    expect((await patient('P-1')).phone).toBe('0612345678');
    expect(await statusesOf(patientRules)).toEqual([
      ['P-1', '1', 'phone', 'pending'],
      ['P-NOBODY', '1', 'phone', 'pending'],
    ]);
  });

  it('writes both legacy rows when two of them share one legacy id', async () => {
    await insertPatients([
      {
        legacyPatientId: 'P-TWIN',
        fullName: 'Fee Visser',
        email: 'fee@old.example',
        phone: '0611111111',
        city: 'Delft',
        rawData: '{"id":"P-TWIN","row":1}',
      },
      {
        legacyPatientId: 'P-TWIN',
        fullName: 'Fee Visser',
        email: 'fee@old.example',
        phone: '0611111111',
        city: 'Delft',
        rawData: '{"id":"P-TWIN","row":2}',
      },
    ]);
    await seedRule('R-TWIN', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-TWIN',
        ruleId: 'R-TWIN',
        column: 'city',
        previousValue: 'Delft',
        nextValue: 'Leiden',
      },
    ]);

    const { body } = await approveRule('R-TWIN');

    // A finding addresses a legacy id, not a physical row — ids are not unique
    // (1.0.3) — so one rule row moves once and both data rows are written,
    // which is why `updated` can exceed `approved`.
    expect(body).toEqual({ ruleId: 'R-TWIN', version: 1, approved: 1, updated: 2 });
    expect(
      (await patients.find({ where: { legacyPatientId: 'P-TWIN' } })).map((row) => row.city),
    ).toEqual(['Leiden', 'Leiden']);
    expect(await statusesOf(patientRules)).toEqual([['P-TWIN', '1', 'city', 'approved']]);
  });

  it('approves a hundred rows and more in one press, with no page in the way', async () => {
    const extra = Array.from({ length: 120 }, (_, index) => {
      const legacyPatientId = `P-B${String(index).padStart(3, '0')}`;

      return {
        legacyPatientId,
        fullName: `Bulk ${index}`,
        email: 'bulk@old.example',
        phone: `06${String(index).padStart(8, '0')}`,
        city: 'Groningen',
        rawData: `{"id":"${legacyPatientId}"}`,
      };
    });

    await insertPatients(extra);
    await seedRule('R-BULK', [1], 1);
    await seedFindings(
      patientRules,
      extra.map((row) => ({
        legacyId: row.legacyPatientId,
        ruleId: 'R-BULK',
        column: 'phone',
        previousValue: row.phone,
        nextValue: `+31${row.phone.slice(1)}`,
      })),
    );

    const { body } = await approveRule('R-BULK');

    expect(body).toEqual({ ruleId: 'R-BULK', version: 1, approved: 120, updated: 120 });

    const written = await patients.find({ where: { city: 'Groningen' } });

    // Every one of them, so a page or a limit anywhere between the endpoint and
    // the tables would show up as a row left behind.
    expect(written.map((row) => [row.legacyPatientId, row.phone]).sort()).toEqual(
      extra.map((row) => [row.legacyPatientId, `+31${row.phone.slice(1)}`]).sort(),
    );
    expect((await ruleRowsOf(patientRules)).every((row) => row.status === 'approved')).toBe(true);
    expect(await patientRules.count()).toBe(120);
  });
});
