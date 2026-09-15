import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApplyRulesResponse } from '../src/apply-rules/apply-rules.controller';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { LegacyPatientRule } from '../src/legacy/legacy-rule.entity';
import type { RegisteredRule, RuleFunction } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * Pressing "Apply rules" (1.2.10), over HTTP, against a real database.
 *
 * The runner (T3.2) and the findings writer (T3.3) each have a suite of their
 * own, and each was tested in isolation — `rule-findings.spec.ts` feeds
 * `persist` a literal run result rather than driving rules to produce one, and
 * says in so many words that joining the two halves end to end is this suite's
 * job. So nothing here asserts that a service was called. Every assertion is
 * about what the legacy rule tables hold once the request came back, which is
 * the only thing that distinguishes "the endpoint ran both halves" from
 * "the endpoint ran one of them".
 *
 * Fake rules, because this body of work is the infrastructure rules run on and
 * not the rules; the catalogue ships empty on purpose and the registry is
 * overridden with the fakes below, which is the wiring real rules will arrive
 * through. Every fake reads real rows and derives its findings from them, so a
 * row in a rule table is proof the endpoint reached the data.
 *
 * Each test activates rule ids of its own, so one test's active version can
 * never be picked up by another's run.
 */

/** A row of any table as the driver returns it, columns and all. */
type StoredRow = Record<string, unknown>;

/** The columns a seeded patient sets; the rest default to null. */
interface PatientSeed {
  legacyPatientId: string;
  fullName?: string | null;
  email?: string | null;
  dob?: string | null;
  phone?: string | null;
  city?: string | null;
  rawData: string;
}

/** Proposes the international form of every Dutch number written the old way. */
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

/** The same idea on another column, so two rules' findings cannot be confused. */
const proposeEmailDomain: RuleFunction = async (context) => {
  const patients = await context.find(LegacyPatient);

  return {
    ambiguity: false,
    updates: patients
      .filter((patient) => patient.email?.endsWith('@old.example') === true)
      .map((patient) => ({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'email',
        prev: patient.email,
        next: patient.email?.replace('@old.example', '@new.example') ?? null,
      })),
  };
};

/**
 * A rule against another source entirely. A finding names its own table (1.1.7)
 * and the endpoint has to put it in that table's rule table, which only a rule
 * reading a second source can show.
 */
const proposeIntakeOutcome: RuleFunction = async (context) => {
  const intakes = await context.find(LegacyIntake);

  return {
    ambiguity: false,
    updates: intakes
      .filter((intake) => intake.outcome === 'ok')
      .map((intake) => ({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'outcome',
        prev: intake.outcome,
        next: 'accepted',
      })),
  };
};

/** One update per row in the table, whatever the table holds. */
const proposeEveryRow: RuleFunction = async (context) => {
  const patients = await context.find(LegacyPatient);

  return {
    ambiguity: false,
    updates: patients.map((patient) => ({
      table: 'patient' as const,
      legacyId: patient.legacyPatientId,
      column: 'full_name',
      prev: patient.fullName,
      next: `${patient.fullName ?? ''} (checked)`,
    })),
  };
};

/** Every fake the suite registers. `R-NO-CODE` is deliberately absent. */
const fakeRules: RegisteredRule[] = [
  { ruleId: 'R-STATUS', version: 1, run: proposePhone },
  { ruleId: 'R-E2E-PHONE', version: 1, run: proposePhone },
  { ruleId: 'R-E2E-INTAKE', version: 1, run: proposeIntakeOutcome },
  { ruleId: 'R-ACTIVE', version: 1, run: proposeEmailDomain },
  { ruleId: 'R-ACTIVE', version: 2, run: proposePhone },
  { ruleId: 'R-WHOLE', version: 1, run: proposeEveryRow },
  { ruleId: 'R-TWICE', version: 1, run: proposePhone },
  { ruleId: 'R-CURRENT', version: 1, run: proposePhone },
  { ruleId: 'R-DECLINED', version: 1, run: proposePhone },
  { ruleId: 'R-DECLINED', version: 2, run: proposePhone },
  { ruleId: 'R-IDLE', version: 1, run: proposePhone },
  { ruleId: 'R-ZZ-REGISTERED', version: 1, run: proposePhone },
  { ruleId: 'R-REC-PHONE', version: 1, run: proposePhone },
  { ruleId: 'R-REC-EMAIL', version: 1, run: proposeEmailDomain },
  { ruleId: 'R-REC-INTAKE', version: 1, run: proposeIntakeOutcome },
];

/**
 * The patients every test starts from.
 *
 * A function rather than a constant, because inserting writes the generated id
 * back into the object it was handed, and a shared object carrying a stale id
 * would be updated instead of inserted on the next test.
 *
 * The two patient fakes match two different sets: phone P-1 and P-3, email P-2
 * and P-4.
 */
function fixedPatients(): PatientSeed[] {
  return [
    {
      legacyPatientId: 'P-1',
      fullName: 'Ana de Vries',
      email: 'ana@new.example',
      dob: '03/07/1984',
      phone: '0612345678',
      city: 'Utrecht',
      rawData: '{"id":"P-1"}',
    },
    {
      legacyPatientId: 'P-2',
      fullName: 'Bram Jansen',
      email: 'bram@old.example',
      dob: '1984-07-03',
      phone: '+31612345679',
      city: 'Amsterdam',
      rawData: '{"id":"P-2"}',
    },
    {
      legacyPatientId: 'P-3',
      fullName: 'Cas Bakker',
      email: 'cas@new.example',
      dob: '11/12/1990',
      phone: '0698765432',
      city: 'Rotterdam',
      rawData: '{"id":"P-3"}',
    },
    {
      legacyPatientId: 'P-4',
      fullName: 'Dee Smit',
      email: 'dee@old.example',
      dob: '1990-12-11',
      phone: null,
      city: 'Den Haag',
      rawData: '{"id":"P-4"}',
    },
  ];
}

/** Two intakes, one of which the intake fake matches. */
function fixedIntakes(): { legacyIntakeId: string; outcome: string; rawData: string }[] {
  return [
    { legacyIntakeId: 'I-1', outcome: 'ok', rawData: '{"id":"I-1"}' },
    { legacyIntakeId: 'I-2', outcome: 'accepted', rawData: '{"id":"I-2"}' },
  ];
}

/** What every counter in a response must add up to, by construction. */
function reconciles(response: ApplyRulesResponse): boolean {
  return response.rules.every(
    (line) => line.found === line.declined + line.repeated + line.written,
  );
}

describe('POST /rules/apply', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let patients: Repository<LegacyPatient>;
  let intakes: Repository<LegacyIntake>;
  let patientRules: Repository<LegacyPatientRule>;
  let rules: Repository<Rule>;
  let versions: Repository<RuleVersion>;
  let ruleVersions: RuleVersionsService;

  /** A rule with versions, all inactive until something activates one (1.1.8). */
  async function seedRule(ruleId: string, versionNumbers: number[]): Promise<void> {
    await rules.save({
      ruleId,
      ruleName: `${ruleId} name`,
      description: `${ruleId} description`,
      ambiguous: false,
    });

    for (const version of versionNumbers) {
      await versions.insert({ ruleId, version });
    }
  }

  /** Chunked, so a hundred seed rows stay inside SQLite's parameter limit. */
  async function insertPatients(rows: PatientSeed[]): Promise<void> {
    for (let index = 0; index < rows.length; index += 50) {
      await patients.insert(rows.slice(index, index + 50));
    }
  }

  /** The press itself. Nothing is sent: the endpoint takes no input. */
  async function press(): Promise<{ status: number; body: ApplyRulesResponse }> {
    const response = await request(app.getHttpServer()).post('/rules/apply');

    return { status: response.status, body: response.body as ApplyRulesResponse };
  }

  /** A rule table exactly as it stands, every column of every row. */
  async function storedRows(table: string): Promise<StoredRow[]> {
    return await dataSource.query<StoredRow[]>(
      `SELECT * FROM ${table} ORDER BY legacy_id, rule_id, version, "column"`,
    );
  }

  /** How many rows each of the three rule tables holds. */
  async function ruleRowCounts(): Promise<number[]> {
    const counts: number[] = [];

    for (const table of ['legacy_patient_rule', 'legacy_intake_rule', 'legacy_consent_rule']) {
      const [counted] = await dataSource.query<{ rows: number }[]>(
        `SELECT COUNT(*) AS rows FROM ${table}`,
      );

      counts.push(counted?.rows ?? -1);
    }

    return counts;
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

    // One test deliberately makes a rule version unresolvable, and Nest logs
    // the stack of any non-HTTP exception it turns into a 500. Silenced so a
    // passing run's output holds no stack trace that looks like a failure.
    app = moduleRef.createNestApplication({ logger: false });
    // Booting is what creates the tables: `synchronize: true` and no migration
    // step to stand in for it (tech-stack 4.4).
    await app.init();
    dataSource = moduleRef.get(DataSource);
    patients = dataSource.getRepository(LegacyPatient);
    intakes = dataSource.getRepository(LegacyIntake);
    patientRules = dataSource.getRepository(LegacyPatientRule);
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

  it('answers 200, not the 201 a POST defaults to', async () => {
    await seedRule('R-STATUS', [1]);
    await ruleVersions.activate('R-STATUS', 1);

    const { status, body } = await press();

    // Nothing was created at a URL — the call reports on work it did — so 201
    // would claim something that is not true.
    expect(status).toBe(200);
    expect(body.totals.written).toBe(2);
  });

  it('runs every active version and writes each finding to the table it names', async () => {
    await seedRule('R-E2E-PHONE', [1]);
    await seedRule('R-E2E-INTAKE', [1]);
    await ruleVersions.activate('R-E2E-PHONE', 1);
    await ruleVersions.activate('R-E2E-INTAKE', 1);

    const { status, body } = await press();

    expect(status).toBe(200);

    // One press, both halves: the runner called both rules (1.2.10) and the
    // persistence layer wrote what they found (1.1.3). Neither half alone
    // produces these rows.
    expect(body.rules).toEqual([
      {
        ruleId: 'R-E2E-INTAKE',
        version: 1,
        found: 1,
        declined: 0,
        repeated: 0,
        written: 1,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
      {
        ruleId: 'R-E2E-PHONE',
        version: 1,
        found: 2,
        declined: 0,
        repeated: 0,
        written: 2,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);

    // Every stored value came from a real row the rule read, and every row is
    // pending: writing a finding decides nothing (1.2.1).
    expect(await storedRows('legacy_patient_rule')).toEqual([
      {
        legacy_id: 'P-1',
        rule_id: 'R-E2E-PHONE',
        version: 1,
        column: 'phone',
        previous_value: '0612345678',
        next_value: '+31612345678',
        status: 'pending',
        reason: null,
      },
      {
        legacy_id: 'P-3',
        rule_id: 'R-E2E-PHONE',
        version: 1,
        column: 'phone',
        previous_value: '0698765432',
        next_value: '+31698765432',
        status: 'pending',
        reason: null,
      },
    ]);

    // The intake rule's finding named `intake`, so it is in the intake rule
    // table and nowhere else (1.1.7) — not merged into the patient table with
    // the phone findings.
    expect(await storedRows('legacy_intake_rule')).toEqual([
      {
        legacy_id: 'I-1',
        rule_id: 'R-E2E-INTAKE',
        version: 1,
        column: 'outcome',
        previous_value: 'ok',
        next_value: 'accepted',
        status: 'pending',
        reason: null,
      },
    ]);
    expect(await storedRows('legacy_consent_rule')).toEqual([]);
  });

  it('writes only what the active version found, never an inactive one', async () => {
    await seedRule('R-ACTIVE', [1, 2]);
    await ruleVersions.activate('R-ACTIVE', 2);

    const { body } = await press();

    // Version 1's code is the email rule and version 2's is the phone rule, so
    // the rows say which code ran and not merely which key was tagged (1.2.10).
    expect(body.rules).toEqual([
      {
        ruleId: 'R-ACTIVE',
        version: 2,
        found: 2,
        declined: 0,
        repeated: 0,
        written: 2,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);

    const rows = await storedRows('legacy_patient_rule');

    expect(rows.map((row) => [row.legacy_id, row.version, row.column])).toEqual([
      ['P-1', 2, 'phone'],
      ['P-3', 2, 'phone'],
    ]);
  });

  it('reaches the entire dataset, with no page or limit in the way', async () => {
    const extra = Array.from({ length: 96 }, (_, index) => ({
      legacyPatientId: `P-G${String(index).padStart(3, '0')}`,
      fullName: `Groningen ${index}`,
      email: 'g@new.example',
      dob: '1981-02-02',
      phone: '+31600000000',
      city: 'Groningen',
      rawData: `{"id":"P-G${String(index).padStart(3, '0')}"}`,
    }));

    await insertPatients(extra);
    await seedRule('R-WHOLE', [1]);
    await ruleVersions.activate('R-WHOLE', 1);

    const { body } = await press();
    const rows = await storedRows('legacy_patient_rule');
    const seededIds = [...fixedPatients(), ...extra]
      .map((patient) => patient.legacyPatientId)
      .sort();

    // The rule returns one update per row it saw, so a page or a limit anywhere
    // between the endpoint and the table would show up as missing rows here
    // (1.2.10).
    expect(body.totals).toEqual({
      versionsRun: 1,
      found: 100,
      declined: 0,
      repeated: 0,
      written: 100,
    });
    expect(rows.map((row) => row.legacy_id).sort()).toEqual(seededIds);
    expect(rows).toContainEqual({
      legacy_id: 'P-2',
      rule_id: 'R-WHOLE',
      version: 1,
      column: 'full_name',
      previous_value: 'Bram Jansen',
      next_value: 'Bram Jansen (checked)',
      status: 'pending',
      reason: null,
    });
  });

  it('changes nothing when pressed a second time on unchanged data', async () => {
    await seedRule('R-TWICE', [1]);
    await ruleVersions.activate('R-TWICE', 1);

    const first = await press();
    const afterFirst = await storedRows('legacy_patient_rule');
    const second = await press();

    expect(first.body.totals.written).toBe(2);

    // The findings are found again — the rule still matches the same rows — and
    // every one of them is accounted for as already recorded. Nothing new, and
    // nothing rewritten.
    expect(second.status).toBe(200);
    expect(second.body.rules).toEqual([
      {
        ruleId: 'R-TWICE',
        version: 1,
        found: 2,
        declined: 0,
        repeated: 2,
        written: 0,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);
    expect(await storedRows('legacy_patient_rule')).toEqual(afterFirst);
  });

  it('reads the data as it stands on the second press, not a snapshot', async () => {
    await seedRule('R-CURRENT', [1]);
    await ruleVersions.activate('R-CURRENT', 1);

    const first = await press();

    expect(first.body.totals.written).toBe(2);

    // What an approved fix and a fresh import look like from the rule's side.
    await patients.update({ legacyPatientId: 'P-1' }, { phone: '+31612345678' });
    await insertPatients([
      {
        legacyPatientId: 'P-9',
        fullName: 'Eef Mulder',
        email: 'eef@new.example',
        dob: '1975-05-05',
        phone: '0655555555',
        city: 'Breda',
        rawData: '{"id":"P-9"}',
      },
    ]);

    const second = await press();

    // 1.2.10's last line: rules read the modified data. P-1 stopped matching,
    // so the second press found it no longer — and P-9, which did not exist
    // during the first press, was found and written.
    expect(second.body.rules).toEqual([
      {
        ruleId: 'R-CURRENT',
        version: 1,
        found: 2,
        declined: 0,
        repeated: 1,
        written: 1,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);

    const rows = await storedRows('legacy_patient_rule');

    expect(rows.map((row) => row.legacy_id)).toEqual(['P-1', 'P-3', 'P-9']);
    expect(rows[2]).toEqual({
      legacy_id: 'P-9',
      rule_id: 'R-CURRENT',
      version: 1,
      column: 'phone',
      previous_value: '0655555555',
      next_value: '+31655555555',
      status: 'pending',
      reason: null,
    });
  });

  it('skips a declined row even under a newer active version', async () => {
    await seedRule('R-DECLINED', [1, 2]);
    // The decision another task's write path leaves behind: P-1's phone was
    // declined while version 1 was the active one.
    await patientRules.insert({
      legacyId: 'P-1',
      ruleId: 'R-DECLINED',
      version: 1,
      column: 'phone',
      previousValue: '0612345678',
      nextValue: '+31612345678',
      status: 'declined',
      reason: 'the patient asked us to leave it alone',
    });
    await ruleVersions.activate('R-DECLINED', 2);

    const { body } = await press();

    // 1.2.9, reached over HTTP rather than by calling the service directly: the
    // skip is on the endpoint's path, and the version is not part of the check.
    expect(body.rules).toEqual([
      {
        ruleId: 'R-DECLINED',
        version: 2,
        found: 2,
        declined: 1,
        repeated: 0,
        written: 1,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);

    const rows = await storedRows('legacy_patient_rule');

    expect(rows.map((row) => [row.legacy_id, row.version, row.status])).toEqual([
      ['P-1', 1, 'declined'],
      ['P-3', 2, 'pending'],
    ]);
  });

  it('reports an empty run when no version is active, however many rules exist', async () => {
    await seedRule('R-IDLE', [1]);

    const { status, body } = await press();

    // The rows drive the run, never the catalogue: code is registered for
    // R-IDLE v1 and it stays uncalled because no row says it is active.
    expect(status).toBe(200);
    expect(body.rules).toEqual([]);
    expect(body.totals).toEqual({
      versionsRun: 0,
      found: 0,
      declined: 0,
      repeated: 0,
      written: 0,
    });
    expect(await ruleRowCounts()).toEqual([0, 0, 0]);
  });

  it('fails the whole press when an active version has no registered code', async () => {
    await seedRule('R-NO-CODE', [1]);
    await seedRule('R-ZZ-REGISTERED', [1]);
    await ruleVersions.activate('R-NO-CODE', 1);
    await ruleVersions.activate('R-ZZ-REGISTERED', 1);

    const response = await request(app.getHttpServer()).post('/rules/apply');

    // A deploy that lost a rule's code is a 500 and not a friendlier status: it
    // is nobody's request that was wrong.
    expect(response.status).toBe(500);

    // And not one row was written, the registered rule that sorts after the
    // missing one included. A press produces a complete findings set or none —
    // never a partial one the rules screen would read as complete (1.1.1).
    expect(await ruleRowCounts()).toEqual([0, 0, 0]);
  });

  it('reports counters that reconcile, and totals that are their sum', async () => {
    await seedRule('R-REC-PHONE', [1]);
    await seedRule('R-REC-EMAIL', [1]);
    await seedRule('R-REC-INTAKE', [1]);
    await patientRules.insert({
      legacyId: 'P-3',
      ruleId: 'R-REC-PHONE',
      version: 1,
      column: 'phone',
      previousValue: '0698765432',
      nextValue: '+31698765432',
      status: 'declined',
      reason: null,
    });
    await ruleVersions.activate('R-REC-PHONE', 1);
    await ruleVersions.activate('R-REC-EMAIL', 1);
    await ruleVersions.activate('R-REC-INTAKE', 1);

    const first = await press();

    // All three outcomes are represented, so the reconciliation has something
    // to reconcile rather than being 0 = 0 + 0 + 0.
    expect(first.body.rules).toEqual([
      {
        ruleId: 'R-REC-EMAIL',
        version: 1,
        found: 2,
        declined: 0,
        repeated: 0,
        written: 2,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
      {
        ruleId: 'R-REC-INTAKE',
        version: 1,
        found: 1,
        declined: 0,
        repeated: 0,
        written: 1,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
      {
        ruleId: 'R-REC-PHONE',
        version: 1,
        found: 2,
        declined: 1,
        repeated: 0,
        written: 1,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);
    expect(reconciles(first.body)).toBe(true);
    expect(first.body.totals).toEqual({
      versionsRun: 3,
      found: 5,
      declined: 1,
      repeated: 0,
      written: 4,
    });

    const second = await press();

    // And again on a press that writes nothing: a run is checkable by comparing
    // counts rather than by tracing rows.
    expect(reconciles(second.body)).toBe(true);
    expect(second.body.totals).toEqual({
      versionsRun: 3,
      found: 5,
      declined: 1,
      repeated: 4,
      written: 0,
    });

    const [patientRuleRows, intakeRuleRows] = await ruleRowCounts();

    expect(patientRuleRows).toBe(4);
    expect(intakeRuleRows).toBe(1);
  });
});
