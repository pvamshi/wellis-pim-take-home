import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApplyRulesResponse } from '../src/apply-rules/apply-rules.controller';
import { AppModule } from '../src/app.module';
import type { DeclineRowResponse, ReviseFromRowResponse } from '../src/decline/decline.controller';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import {
  LegacyPatientRule,
  type LegacyRuleRow,
  type LegacyRuleStatus,
} from '../src/legacy/legacy-rule.entity';
import type { RegisteredRule, RuleFunction } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * Crossing out one row with "modify the rule" ticked (1.2.8), over HTTP and
 * against a real database.
 *
 * The press is the third one on the cross, and the only one of the three whose
 * point is what it leaves alone: the rule's active version is parked exactly as
 * a rule-level Decline parks it (1.2.6), and the row that exposed the bug stays
 * pending so the version that replaces it proposes on that very row.
 *
 * Nothing here asserts that a service was called. "P-0817's rule row is NOT
 * declined" is not a call that did not happen — it is a row that is still
 * pending, and two tests below go further and prove the row is still *eligible*
 * by activating the next version and running the rules for real. A test that
 * watched a call could tell none of that apart.
 *
 * The fakes exist for those two runs only. This body of work is the
 * infrastructure rules run on, not the rules; the catalogue ships empty on
 * purpose and the registry is overridden the same way `apply-rules.spec.ts` and
 * `decline-row.spec.ts` override it.
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
 * The same fake `apply-rules.spec.ts` and `decline-row.spec.ts` use, and
 * self-terminating for the same reason (1.1.5): it matches on the column it
 * rewrites, so a row it already fixed stops matching. Only the two tests that
 * press Apply rules need it.
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
 * Every fake the suite registers: two versions of each rule that gets run, so
 * the revision workflow has a version 2 to activate (1.5.1) and the run after
 * it is a real run of real registered code.
 */
const fakeRules: RegisteredRule[] = [
  { ruleId: 'R-ELIGIBLE', version: 1, run: proposePhone },
  { ruleId: 'R-ELIGIBLE', version: 2, run: proposePhone },
  { ruleId: 'R-CONTRAST', version: 1, run: proposePhone },
  { ruleId: 'R-CONTRAST', version: 2, run: proposePhone },
];

/**
 * The patients every test starts from, listed in the order SQLite returns them
 * for `ORDER BY legacy_id`, which is what `storedPatients` below compares.
 *
 * A function rather than a constant, because inserting writes the generated id
 * back into the object it was handed, and a shared object carrying a stale id
 * would be updated instead of inserted on the next test.
 *
 * P-0817 is 1.2.8's own patient — the row that is the evidence. P-3 has no
 * phone at all, so the phone fake matches three of the four and a run's counts
 * are not simply "every row".
 */
function fixedPatients(): PatientSeed[] {
  return [
    {
      legacyPatientId: 'P-0817',
      fullName: 'Ana de Vries',
      email: 'ana@old.example',
      phone: '0681700000',
      city: 'Utrecht',
      rawData: '{"id":"P-0817"}',
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

describe('excluding a row and revising the rule', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let patients: Repository<LegacyPatient>;
  let patientRules: Repository<LegacyPatientRule>;
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

  /** The press itself: the cross on one row, checkbox ticked (1.2.8). */
  async function reviseFromRow(
    ruleId: string,
    body: unknown,
  ): Promise<{ status: number; body: ReviseFromRowResponse }> {
    const response = await request(app.getHttpServer())
      .post(`/rules/${ruleId}/rows/revise`)
      .send(body as object);

    return { status: response.status, body: response.body as ReviseFromRowResponse };
  }

  /** The other cross, checkbox unticked (1.2.7) — the press this one contrasts with. */
  async function declineRow(
    ruleId: string,
    body: unknown,
  ): Promise<{ status: number; body: DeclineRowResponse }> {
    const response = await request(app.getHttpServer())
      .post(`/rules/${ruleId}/rows/decline`)
      .send(body as object);

    return { status: response.status, body: response.body as DeclineRowResponse };
  }

  /** "Apply rules" (1.2.10), which is where an eligible row has to come back. */
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
    await patients.insert(fixedPatients());
  });

  it('parks the rule’s active version and stores the reason on it', async () => {
    await seedRule('R-PARKED', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0817',
        ruleId: 'R-PARKED',
        column: 'phone',
        previousValue: '0681700000',
        nextValue: '+31681700000',
      },
    ]);

    const { status, body } = await reviseFromRow('R-PARKED', {
      table: 'patient',
      legacyId: 'P-0817',
      version: 1,
      column: 'phone',
      reason: 'it drops the leading zero on 0681 numbers',
    });

    // 200 rather than the 201 a POST defaults to: nothing was created at a URL.
    // The response names the version that was parked and echoes the row it was
    // handed, so the caller can see the press it made is the press that landed.
    expect(status).toBe(200);
    expect(body).toEqual({
      ruleId: 'R-PARKED',
      version: 1,
      reason: 'it drops the leading zero on 0681 numbers',
      row: { table: 'patient', legacyId: 'P-0817', version: 1, column: 'phone' },
    });

    // 1.2.8's second and third Thens, read off the table rather than off the
    // response: inactive, in the revision queue (1.5.1), with the reason stored
    // against the version.
    const stored = await dataSource.query<StoredRow[]>(
      `SELECT * FROM rule_version WHERE rule_id = 'R-PARKED'`,
    );

    expect(stored).toEqual([
      {
        rule_id: 'R-PARKED',
        version: 1,
        status: 'inactive',
        needs_review: 1,
        reason: 'it drops the leading zero on 0681 numbers',
      },
    ]);
    expect(await activeVersionsOf('R-PARKED')).toEqual([]);
  });

  it('leaves the crossed-out row pending, with no reason on it', async () => {
    await seedRule('R-ROW-KEPT', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0817',
        ruleId: 'R-ROW-KEPT',
        column: 'phone',
        previousValue: '0681700000',
        nextValue: '+31681700000',
      },
    ]);

    await reviseFromRow('R-ROW-KEPT', {
      table: 'patient',
      legacyId: 'P-0817',
      version: 1,
      column: 'phone',
      reason: 'the rule is wrong, not this patient',
    });

    // 1.2.8's first Then: "P-0817's rule row is NOT declined". Every column of
    // it, so nothing was quietly rewritten — the status is still pending, both
    // values are still what the run proposed, and the reason column is still
    // null because the reason went to the version. That last point is the whole
    // difference between this press and the unticked cross (1.2.7).
    const stored = await dataSource.query<StoredRow[]>(`SELECT * FROM legacy_patient_rule`);

    expect(stored).toEqual([
      {
        legacy_id: 'P-0817',
        rule_id: 'R-ROW-KEPT',
        version: 1,
        column: 'phone',
        previous_value: '0681700000',
        next_value: '+31681700000',
        status: 'pending',
        reason: null,
      },
    ]);
  });

  it('treats a missing, null or blank reason as no reason, and trims a padded one', async () => {
    await seedRule('R-ABSENT', [1], 1);
    await seedRule('R-NULLED', [1], 1);
    await seedRule('R-BLANK', [1], 1);
    await seedRule('R-PADDED', [1], 1);

    // The same address for all four, because the rule id is the URL's and not
    // the body's: four rules, so four presses each have an active version to
    // park (a second press on one rule would find nothing).
    const address: RowAddressBody = {
      table: 'patient',
      legacyId: 'P-0817',
      version: 1,
      column: 'phone',
    };

    const absent = await reviseFromRow('R-ABSENT', address);
    const nulled = await reviseFromRow('R-NULLED', { ...address, reason: null });
    const blank = await reviseFromRow('R-BLANK', { ...address, reason: '   ' });
    const padded = await reviseFromRow('R-PADDED', {
      ...address,
      reason: '  it matched Belgian numbers too  ',
    });

    // The reason is optional, exactly as it is for the other two presses
    // (1.2.6, 1.2.7): a ticked cross without one parks the rule and records
    // nothing in its place. A reason of only whitespace is the same press — a
    // version holding " " would read as feedback Vamshi typed to the revision
    // workflow (1.5.1) — and the padding around a real one is not part of what
    // he wrote.
    expect([absent.body.reason, nulled.body.reason, blank.body.reason]).toEqual([null, null, null]);
    expect(padded.body.reason).toBe('it matched Belgian numbers too');

    for (const ruleId of ['R-ABSENT', 'R-NULLED', 'R-BLANK']) {
      const parked = await versionOf(ruleId, 1);

      expect(parked.status).toBe('inactive');
      expect(parked.needsReview).toBe(true);
      expect(parked.reason).toBeNull();
    }

    const trimmed = await versionOf('R-PADDED', 1);

    expect(trimmed.needsReview).toBe(true);
    expect(trimmed.reason).toBe('it matched Belgian numbers too');
  });

  it('parks the whole rule and decides none of its rows', async () => {
    await seedRule('R-ALL-ROWS', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0817',
        ruleId: 'R-ALL-ROWS',
        column: 'phone',
        previousValue: '0681700000',
        nextValue: '+31681700000',
      },
      {
        legacyId: 'P-1',
        ruleId: 'R-ALL-ROWS',
        column: 'phone',
        previousValue: '0611111111',
        nextValue: '+31611111111',
      },
      {
        legacyId: 'P-2',
        ruleId: 'R-ALL-ROWS',
        column: 'phone',
        previousValue: '0622222222',
        nextValue: '+31622222222',
      },
    ]);

    await reviseFromRow('R-ALL-ROWS', {
      table: 'patient',
      legacyId: 'P-0817',
      version: 1,
      column: 'phone',
      reason: 'one bad row usually means others',
    });

    // "The whole rule parks until a new version exists" (1.2.8), and parking is
    // all it does: the rule leaves the screen because the screen filters to
    // active versions (1.2.1), not because anything was decided. So all three
    // rows are still pending with both values intact — including the two the
    // press never named, which is the difference from the unticked cross, where
    // exactly one row would now be declined (1.2.7).
    expect(await activeVersionsOf('R-ALL-ROWS')).toEqual([]);
    expect(await ruleRowsOf(patientRules)).toEqual([
      {
        legacyId: 'P-0817',
        ruleId: 'R-ALL-ROWS',
        version: 1,
        column: 'phone',
        previousValue: '0681700000',
        nextValue: '+31681700000',
        status: 'pending',
        reason: null,
      },
      {
        legacyId: 'P-1',
        ruleId: 'R-ALL-ROWS',
        version: 1,
        column: 'phone',
        previousValue: '0611111111',
        nextValue: '+31611111111',
        status: 'pending',
        reason: null,
      },
      {
        legacyId: 'P-2',
        ruleId: 'R-ALL-ROWS',
        version: 1,
        column: 'phone',
        previousValue: '0622222222',
        nextValue: '+31622222222',
        status: 'pending',
        reason: null,
      },
    ]);
  });

  it('writes nothing to the legacy data', async () => {
    await seedRule('R-NO-DATA', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0817',
        ruleId: 'R-NO-DATA',
        column: 'phone',
        previousValue: '0681700000',
        nextValue: '+31681700000',
      },
    ]);

    await reviseFromRow('R-NO-DATA', {
      table: 'patient',
      legacyId: 'P-0817',
      version: 1,
      column: 'phone',
      reason: 'the number it proposes is wrong',
    });

    // The press parks a rule and applies nothing. The row it names was pending,
    // and a pending row was never written to the data (1.2.5) — so a patient
    // carrying its nextValue here would mean the press had applied the change
    // it was told was wrong. Every column of every patient, so a write to a
    // neighbouring column or row would show up too.
    expect(await storedPatients()).toEqual(seededPatientRows());
  });

  it('leaves the row eligible: the next version proposes on it again', async () => {
    await seedRule('R-ELIGIBLE', [1, 2], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0817',
        ruleId: 'R-ELIGIBLE',
        column: 'phone',
        previousValue: '0681700000',
        nextValue: '+31681700000',
      },
    ]);

    const pressed = await reviseFromRow('R-ELIGIBLE', {
      table: 'patient',
      legacyId: 'P-0817',
      version: 1,
      column: 'phone',
      reason: 'it proposes the wrong number for this patient',
    });

    expect(pressed.body.version).toBe(1);
    expect((await versionOf('R-ELIGIBLE', 1)).needsReview).toBe(true);

    // The revision workflow's end of it (1.5.1): the queued version is revised
    // and version 2 becomes the active code.
    await ruleVersions.activate('R-ELIGIBLE', 2);

    const { status, body } = await applyRules();

    // This is the point of 1.2.8. Version 2 finds all three matching patients
    // and nothing is dropped: P-0817 was never declined, so the shared API has
    // no decline to look up for it (1.2.9), and a pending row is written for
    // exactly the row that exposed the bug.
    expect(status).toBe(200);
    expect(body.rules).toEqual([
      {
        ruleId: 'R-ELIGIBLE',
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

    // Version 1's row is still there beside version 2's at the same legacy id
    // and column: a rule row's key includes the version, so a revised version
    // adds a row rather than replacing one, and the log keeps pointing at the
    // code that proposed each change (1.3).
    expect(await decisionsOf(patientRules)).toEqual([
      ['P-0817', 'R-ELIGIBLE', 1, 'phone', 'pending', null],
      ['P-0817', 'R-ELIGIBLE', 2, 'phone', 'pending', null],
      ['P-1', 'R-ELIGIBLE', 2, 'phone', 'pending', null],
      ['P-2', 'R-ELIGIBLE', 2, 'phone', 'pending', null],
    ]);
  });

  it('differs from the unticked cross: only the ticked row comes back', async () => {
    await seedRule('R-CONTRAST', [1, 2], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0817',
        ruleId: 'R-CONTRAST',
        column: 'phone',
        previousValue: '0681700000',
        nextValue: '+31681700000',
      },
      {
        legacyId: 'P-1',
        ruleId: 'R-CONTRAST',
        column: 'phone',
        previousValue: '0611111111',
        nextValue: '+31611111111',
      },
    ]);

    // The same cross on two rows of the same rule, differing only by the tick:
    // P-1 without it (1.2.7), P-0817 with it (1.2.8).
    const unticked = await declineRow('R-CONTRAST', {
      table: 'patient',
      legacyId: 'P-1',
      version: 1,
      column: 'phone',
      reason: 'that number is the practice, not the patient',
    });
    const ticked = await reviseFromRow('R-CONTRAST', {
      table: 'patient',
      legacyId: 'P-0817',
      version: 1,
      column: 'phone',
      reason: 'this one says the rule itself is wrong',
    });

    expect(unticked.body.declined).toBe(1);
    expect(ticked.body.version).toBe(1);

    await ruleVersions.activate('R-CONTRAST', 2);

    const { body } = await applyRules();

    // One run, two crossed-out rows, opposite outcomes. The unticked one is
    // blocked forever (1.2.9) and the ticked one is proposed on again, which is
    // the whole of what the checkbox buys.
    expect(body.rules).toEqual([
      {
        ruleId: 'R-CONTRAST',
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
    expect(await decisionsOf(patientRules)).toEqual([
      ['P-0817', 'R-CONTRAST', 1, 'phone', 'pending', null],
      ['P-0817', 'R-CONTRAST', 2, 'phone', 'pending', null],
      ['P-1', 'R-CONTRAST', 1, 'phone', 'declined', 'that number is the practice, not the patient'],
      ['P-2', 'R-CONTRAST', 2, 'phone', 'pending', null],
    ]);
  });

  it('parks nothing on a second press, or on a rule id nobody has written', async () => {
    await seedRule('R-TWICE', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0817',
        ruleId: 'R-TWICE',
        column: 'phone',
        previousValue: '0681700000',
        nextValue: '+31681700000',
      },
    ]);

    const address: RowAddressBody = {
      table: 'patient',
      legacyId: 'P-0817',
      version: 1,
      column: 'phone',
    };

    const first = await reviseFromRow('R-TWICE', { ...address, reason: 'the first reason' });
    const second = await reviseFromRow('R-TWICE', { ...address, reason: 'the second reason' });
    const missing = await reviseFromRow('R-NOWHERE', {
      ...address,
      reason: 'a rule that is not there',
    });

    // Neither later press has an active version to act on — the first parked it
    // and it is waiting on the revision workflow (1.5.1), the last names a rule
    // id nobody has written. Both are a report rather than a fault, for an
    // operator pressing from a screen that may be a moment stale (1.2.12), and
    // both still echo the row they were handed.
    expect(first.body.version).toBe(1);
    expect([second.status, missing.status]).toEqual([200, 200]);
    expect(second.body).toEqual({
      ruleId: 'R-TWICE',
      version: null,
      reason: null,
      row: { table: 'patient', legacyId: 'P-0817', version: 1, column: 'phone' },
    });
    expect(missing.body).toEqual({
      ruleId: 'R-NOWHERE',
      version: null,
      reason: null,
      row: { table: 'patient', legacyId: 'P-0817', version: 1, column: 'phone' },
    });

    // The second press is inert: the version keeps the reason the press that
    // actually parked it gave, and nothing was invented for the rule id that
    // does not exist.
    const parked = await versionOf('R-TWICE', 1);

    expect(parked.status).toBe('inactive');
    expect(parked.needsReview).toBe(true);
    expect(parked.reason).toBe('the first reason');
    expect(await versions.count({ where: { ruleId: 'R-NOWHERE' } })).toBe(0);

    // And no press of this route ever declines the row it names, least of all
    // one that found nothing to park (1.2.8).
    expect(await decisionsOf(patientRules)).toEqual([
      ['P-0817', 'R-TWICE', 1, 'phone', 'pending', null],
    ]);
  });

  it('parks nothing when the request itself is malformed', async () => {
    await seedRule('R-MALFORMED', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0817',
        ruleId: 'R-MALFORMED',
        column: 'phone',
        previousValue: '0681700000',
        nextValue: '+31681700000',
      },
    ]);

    const address: RowAddressBody = {
      table: 'patient',
      legacyId: 'P-0817',
      version: 1,
      column: 'phone',
    };

    const pluralTable = await reviseFromRow('R-MALFORMED', { ...address, table: 'patients' });
    const emptyLegacyId = await reviseFromRow('R-MALFORMED', { ...address, legacyId: '' });
    const fractionalVersion = await reviseFromRow('R-MALFORMED', { ...address, version: 1.5 });
    const numericReason = await reviseFromRow('R-MALFORMED', { ...address, reason: 7 });
    const noBody = await reviseFromRow('R-MALFORMED', undefined);

    // A caller's mistake is the one thing that is a 400 here, and it parks
    // nothing: a rule parked with a coerced reason the revision workflow would
    // later read as feedback (1.5.1) is worse than the press failing.
    expect([
      pluralTable.status,
      emptyLegacyId.status,
      fractionalVersion.status,
      numericReason.status,
      noBody.status,
    ]).toEqual([400, 400, 400, 400, 400]);

    const untouched = await versionOf('R-MALFORMED', 1);

    expect(untouched.status).toBe('active');
    expect(untouched.needsReview).toBe(false);
    expect(untouched.reason).toBeNull();
    expect(await activeVersionsOf('R-MALFORMED')).toEqual([1]);
    expect(await decisionsOf(patientRules)).toEqual([
      ['P-0817', 'R-MALFORMED', 1, 'phone', 'pending', null],
    ]);
  });

  it('parks one rule’s active version, whatever version the row names', async () => {
    await seedRule('R-TARGET', [1, 2], 2);
    await seedRule('R-BYSTANDER', [1], 1);
    await seedFindings(patientRules, [
      {
        legacyId: 'P-0817',
        ruleId: 'R-TARGET',
        column: 'phone',
        previousValue: '0681700000',
        nextValue: '+31681700000',
      },
      {
        legacyId: 'P-0817',
        ruleId: 'R-BYSTANDER',
        column: 'phone',
        previousValue: '0681700000',
        nextValue: '0031681700000',
      },
    ]);

    // The address names version 1, which was superseded long ago: the screen
    // the operator is looking at may be showing a finding an older version
    // wrote. 1.2.8 parks "R7's active version" regardless.
    const { body } = await reviseFromRow('R-TARGET', {
      table: 'patient',
      legacyId: 'P-0817',
      version: 1,
      column: 'phone',
      reason: 'version 2 is the broken one',
    });

    expect(body).toEqual({
      ruleId: 'R-TARGET',
      version: 2,
      reason: 'version 2 is the broken one',
      row: { table: 'patient', legacyId: 'P-0817', version: 1, column: 'phone' },
    });

    // Version 1 was superseded and nobody declined it, so it must not be
    // stamped with this reason or pushed into the revision queue...
    const superseded = await versionOf('R-TARGET', 1);

    expect(superseded.status).toBe('inactive');
    expect(superseded.needsReview).toBe(false);
    expect(superseded.reason).toBeNull();

    const parked = await versionOf('R-TARGET', 2);

    expect(parked.status).toBe('inactive');
    expect(parked.needsReview).toBe(true);
    expect(parked.reason).toBe('version 2 is the broken one');

    // ...and "exactly one version is active" is a per-rule fact (1.1.8), so one
    // press must not park the whole screen (1.2.1). The bystander keeps its
    // active version, stays out of the revision queue, and keeps its pending
    // row at the identical legacy id and column.
    expect(await activeVersionsOf('R-TARGET')).toEqual([]);
    expect(await activeVersionsOf('R-BYSTANDER')).toEqual([1]);

    const bystander = await versionOf('R-BYSTANDER', 1);

    expect(bystander.needsReview).toBe(false);
    expect(bystander.reason).toBeNull();
    expect(await decisionsOf(patientRules)).toEqual([
      ['P-0817', 'R-BYSTANDER', 1, 'phone', 'pending', null],
      ['P-0817', 'R-TARGET', 1, 'phone', 'pending', null],
    ]);
  });
});
