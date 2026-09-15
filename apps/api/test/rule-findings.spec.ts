import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { Duplicate } from '../src/duplicates/duplicate.entity';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import {
  LegacyConsentRule,
  LegacyIntakeRule,
  LegacyPatientRule,
  type LegacyRuleRow,
} from '../src/legacy/legacy-rule.entity';
import type { LegacySourceTable } from '../src/legacy/legacy-source-table';
import {
  DuplicateLinkMissingRowIdError,
  RuleFindingsService,
  UnknownSourceTableError,
  type RuleFindingsReport,
} from '../src/rules/rule-findings.service';
import type { DuplicateFinding, RuleUpdate } from '../src/rules/rule-contract';
import type { RuleRunEntry, RuleRunResult } from '../src/rules/rule-runner.service';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * The persistence half of 1.1.3, against a real database.
 *
 * The unit under test takes the runner's JSON, so the JSON is the fixture:
 * every case below feeds `persist` a literal `RuleRunResult` rather than
 * driving rules and a registry to produce one. Joining the two halves end to
 * end is the apply-rules endpoint's test (T3.4).
 *
 * Prior decisions — a declined row, an approved row — are seeded straight
 * through the rule repositories, because deciding on a row is another task's
 * write path and this one only ever has to read what it left behind.
 */

/** A row of any table as the driver returns it, columns and all. */
type StoredRow = Record<string, unknown>;

/** One finding, written the way `RuleUpdate` defines it (1.1.7). */
function found(
  table: LegacySourceTable,
  legacyId: string,
  column: string,
  prev: string | null,
  next: string | null,
): RuleUpdate {
  return { table, legacyId, column, prev, next };
}

/**
 * One duplicate finding, written the way `DuplicateFinding` defines it
 * (1.7.1). Row ids are optional parameters, not just optional fields, so a
 * test can build a finding missing one on purpose (T3.7-style, for
 * `DuplicateLinkMissingRowIdError`).
 */
function duplicate(
  table: LegacySourceTable,
  duplicateLegacyId: string,
  canonicalLegacyId: string,
  duplicateRowId?: string,
  canonicalRowId?: string,
): DuplicateFinding {
  return { table, duplicateLegacyId, canonicalLegacyId, duplicateRowId, canonicalRowId };
}

/** One rule version's response, tagged with the key that produced it. */
function entry(
  ruleId: string,
  version: number,
  updates: RuleUpdate[],
  ambiguity = false,
  duplicates: DuplicateFinding[] = [],
): RuleRunEntry {
  return { ruleId, version, response: { ambiguity, updates, duplicates } };
}

/** The rule rows a table holds, in an order no assertion depends on. */
async function rowsOf(repository: Repository<LegacyRuleRow>): Promise<LegacyRuleRow[]> {
  return await repository.find({
    order: { legacyId: 'ASC', ruleId: 'ASC', version: 'ASC', column: 'ASC' },
  });
}

/** The links `duplicate` holds, in an order no assertion depends on. */
async function linksOf(repository: Repository<Duplicate>): Promise<Duplicate[]> {
  return await repository.find({
    order: { sourceTable: 'ASC', duplicateRowId: 'ASC', canonicalRowId: 'ASC' },
  });
}

/** What every counter in a report must add up to, by construction. */
function reconciles(report: RuleFindingsReport): boolean {
  return report.every(
    (line) =>
      line.found === line.declined + line.repeated + line.written &&
      line.linksFound === line.linksRecorded + line.linksSkipped,
  );
}

describe('persisting a run as rule rows', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let findings: RuleFindingsService;
  let patientRules: Repository<LegacyPatientRule>;
  let intakeRules: Repository<LegacyIntakeRule>;
  let consentRules: Repository<LegacyConsentRule>;
  let duplicates: Repository<Duplicate>;

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    // Booting is what creates the tables: `synchronize: true` and no migration
    // step to stand in for it (tech-stack 4.4).
    await app.init();
    dataSource = moduleRef.get(DataSource);
    findings = moduleRef.get(RuleFindingsService);
    patientRules = dataSource.getRepository(LegacyPatientRule);
    intakeRules = dataSource.getRepository(LegacyIntakeRule);
    consentRules = dataSource.getRepository(LegacyConsentRule);
    duplicates = dataSource.getRepository(Duplicate);
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
    await dataSource.query(`DELETE FROM duplicate`);
    await dataSource.query(`DELETE FROM rule_version`);
    await dataSource.query(`DELETE FROM rule`);
    await dataSource.query(`DELETE FROM legacy_patient`);
    await dataSource.query(`DELETE FROM legacy_intake`);
    await dataSource.query(`DELETE FROM legacy_consent`);
  });

  it('writes a finding nobody has decided on as one pending row', async () => {
    const report = await findings.persist([
      entry('R7', 2, [found('patient', 'P-0455', 'phone', '0612345678', '+31612345678')]),
    ]);

    // 1.1.3: the rule returned JSON, this layer wrote the row. Every part of
    // the finding is stored, the rule and version that produced it included
    // (1.3), and the row waits for a decision.
    expect(await rowsOf(patientRules)).toEqual([
      {
        legacyId: 'P-0455',
        ruleId: 'R7',
        version: 2,
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
        status: 'pending',
        reason: null,
      },
    ]);
    expect(report).toEqual([
      {
        ruleId: 'R7',
        version: 2,
        found: 1,
        declined: 0,
        repeated: 0,
        written: 1,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);
  });

  it('routes each finding to the table its own table field names', async () => {
    await findings.persist([
      entry('R-SPAN', 1, [
        found('intake', 'I-900', 'weight', '82kg', '82'),
        found('patient', 'P-1', 'weight_unit', null, 'kg'),
        found('consent', 'C-77', 'at', '2021/03/04', '2021-03-04'),
      ]),
    ]);

    // A rule's scope may span tables (1.1.6) and its findings are still
    // field-shaped (1.1.7), so one response lands in three tables — each row in
    // exactly one of them, with nothing duplicated into the others.
    expect((await rowsOf(patientRules)).map((row) => [row.legacyId, row.column])).toEqual([
      ['P-1', 'weight_unit'],
    ]);
    expect((await rowsOf(intakeRules)).map((row) => [row.legacyId, row.column])).toEqual([
      ['I-900', 'weight'],
    ]);
    expect((await rowsOf(consentRules)).map((row) => [row.legacyId, row.column])).toEqual([
      ['C-77', 'at'],
    ]);
  });

  it('drops a finding for a row declined under an earlier version', async () => {
    await patientRules.insert({
      legacyId: 'P-0455',
      ruleId: 'R7',
      version: 1,
      column: 'phone',
      previousValue: '0612345678',
      nextValue: '+31612345678',
      status: 'declined',
      reason: 'that number is the practice, not the patient',
    });

    const report = await findings.persist([
      entry('R7', 2, [found('patient', 'P-0455', 'phone', '0612345678', '0031612345678')]),
    ]);

    // 1.2.9's scenario exactly: the decline is looked up by
    // (legacyId, ruleId, column), so version 2 writes no pending row — and the
    // declined row it met is left exactly as it was, reason included.
    expect(await rowsOf(patientRules)).toEqual([
      {
        legacyId: 'P-0455',
        ruleId: 'R7',
        version: 1,
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
        status: 'declined',
        reason: 'that number is the practice, not the patient',
      },
    ]);
    expect(report).toEqual([
      {
        ruleId: 'R7',
        version: 2,
        found: 1,
        declined: 1,
        repeated: 0,
        written: 0,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);
  });

  it('keys the skip on the row, the rule and the column together', async () => {
    await patientRules.insert({
      legacyId: 'P-0455',
      ruleId: 'R7',
      version: 1,
      column: 'phone',
      previousValue: '0612345678',
      nextValue: '+31612345678',
      status: 'declined',
      reason: null,
    });

    await findings.persist([
      entry('R7', 2, [
        found('patient', 'P-0455', 'email', 'old@example', 'new@example'),
        found('patient', 'P-0999', 'phone', '0611111111', '+31611111111'),
      ]),
      entry('R9', 1, [found('patient', 'P-0455', 'phone', '0612345678', '+31612345678')]),
    ]);

    // Change any one of the three parts and the decline no longer applies: a
    // different column, a different rule, a different row. Nothing broader than
    // (legacyId, ruleId, column) is being matched on.
    expect(
      (await rowsOf(patientRules)).map((row) => [
        row.legacyId,
        row.ruleId,
        row.version,
        row.column,
        row.status,
      ]),
    ).toEqual([
      ['P-0455', 'R7', 1, 'phone', 'declined'],
      ['P-0455', 'R7', 2, 'email', 'pending'],
      ['P-0455', 'R9', 1, 'phone', 'pending'],
      ['P-0999', 'R7', 2, 'phone', 'pending'],
    ]);
  });

  it('scopes the skip to the source table the decline was recorded against', async () => {
    await patientRules.insert({
      legacyId: 'X-1',
      ruleId: 'R7',
      version: 1,
      column: 'weight',
      previousValue: '82kg',
      nextValue: '82',
      status: 'declined',
      reason: null,
    });

    const report = await findings.persist([
      entry('R7', 1, [found('intake', 'X-1', 'weight', '82kg', '82')]),
    ]);

    // The three sources are separate namespaces — the same legacy id in two of
    // them is two different rows — so a decline against the patient table says
    // nothing about the intake table.
    expect(
      (await rowsOf(intakeRules)).map((row) => [row.legacyId, row.column, row.status]),
    ).toEqual([['X-1', 'weight', 'pending']]);
    expect(report).toEqual([
      {
        ruleId: 'R7',
        version: 1,
        found: 1,
        declined: 0,
        repeated: 0,
        written: 1,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);
  });

  it('lets a new version propose again over a row that was approved', async () => {
    await patientRules.insert({
      legacyId: 'P-1',
      ruleId: 'R7',
      version: 1,
      column: 'phone',
      previousValue: '0612345678',
      nextValue: '+31612345678',
      status: 'approved',
      reason: null,
    });

    const report = await findings.persist([
      entry('R7', 2, [found('patient', 'P-1', 'phone', '+31612345678', '+31 6 12345678')]),
    ]);

    // Only a decline is forever (1.2.9). An approval is a decision about one
    // address, not a veto on the rule, so version 2's finding is written
    // alongside it as a new pending row.
    expect(
      (await rowsOf(patientRules)).map((row) => [row.version, row.status, row.nextValue]),
    ).toEqual([
      [1, 'approved', '+31612345678'],
      [2, 'pending', '+31 6 12345678'],
    ]);
    expect(report).toEqual([
      {
        ruleId: 'R7',
        version: 2,
        found: 1,
        declined: 0,
        repeated: 0,
        written: 1,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);
  });

  it('never rewrites a row it did not create, however often it runs', async () => {
    const result: RuleRunResult = [
      entry('R7', 1, [
        found('patient', 'P-1', 'phone', '0612345678', '+31612345678'),
        found('patient', 'P-2', 'email', 'bram@old.example', 'bram@new.example'),
      ]),
    ];

    await findings.persist(result);
    // What a decision on one of the two rows leaves behind.
    await patientRules.update(
      { legacyId: 'P-1', ruleId: 'R7', version: 1, column: 'phone' },
      { status: 'approved' },
    );

    const second = await findings.persist(result);

    // Pressing Apply rules twice is harmless: one row per address still, and
    // the approved row keeps its status and both of its values. Rewriting it
    // would contradict 1.2.11 and make the modification log (1.3) describe a
    // change that never happened.
    expect(await rowsOf(patientRules)).toEqual([
      {
        legacyId: 'P-1',
        ruleId: 'R7',
        version: 1,
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
        status: 'approved',
        reason: null,
      },
      {
        legacyId: 'P-2',
        ruleId: 'R7',
        version: 1,
        column: 'email',
        previousValue: 'bram@old.example',
        nextValue: 'bram@new.example',
        status: 'pending',
        reason: null,
      },
    ]);
    expect(second).toEqual([
      {
        ruleId: 'R7',
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
  });

  it('collapses two findings at one address inside a single response', async () => {
    const report = await findings.persist([
      entry('R-CITY', 1, [
        found('patient', 'P-DUP', 'city', 'Utrecht ', 'Utrecht'),
        found('patient', 'P-DUP', 'city', 'utrecht', 'Utrecht'),
      ]),
    ]);

    // Two legacy rows may share one legacy id (1.0.3), and a rule reading whole
    // tables returns both. A rule row addresses a legacy id rather than a
    // physical row, so the second finding collapses into the first instead of
    // failing the write — and the first occurrence's values are what is stored.
    expect(await rowsOf(patientRules)).toEqual([
      {
        legacyId: 'P-DUP',
        ruleId: 'R-CITY',
        version: 1,
        column: 'city',
        previousValue: 'Utrecht ',
        nextValue: 'Utrecht',
        status: 'pending',
        reason: null,
      },
    ]);
    expect(report).toEqual([
      {
        ruleId: 'R-CITY',
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
  });

  it('stores an ambiguous response as it arrived, with no next value', async () => {
    await findings.persist([
      entry(
        'R-DOB',
        3,
        [
          found('patient', 'P-1', 'dob', '03/07/1984', null),
          found('patient', 'P-3', 'dob', '11/12/1990', null),
        ],
        true,
      ),
    ]);

    // 1.1.12: an ambiguous rule finds problems it cannot fix, so its findings
    // carry a previous value and no next one. This layer stores what came back
    // and interprets none of it — no value invented, no row dropped for being
    // unfixable.
    expect(await rowsOf(patientRules)).toEqual([
      {
        legacyId: 'P-1',
        ruleId: 'R-DOB',
        version: 3,
        column: 'dob',
        previousValue: '03/07/1984',
        nextValue: null,
        status: 'pending',
        reason: null,
      },
      {
        legacyId: 'P-3',
        ruleId: 'R-DOB',
        version: 3,
        column: 'dob',
        previousValue: '11/12/1990',
        nextValue: null,
        status: 'pending',
        reason: null,
      },
    ]);
  });

  it('writes more findings than one statement can carry', async () => {
    const updates = Array.from({ length: 5000 }, (_, index) => {
      const legacyId = `P-B${String(index).padStart(4, '0')}`;

      return found(
        'patient',
        legacyId,
        'phone',
        `06${10_000_000 + index}`,
        `+316${10_000_000 + index}`,
      );
    });

    const report = await findings.persist([entry('R-BULK', 1, updates)]);

    // A rule answers in batches (1.1.14), and 5000 rule rows is more bound
    // parameters than SQLite will take in one statement — its ceiling is 32,766
    // and a rule row is eight columns. Every row still lands, so the write is
    // chunked bulk work: not one statement that cannot exist, and not 5000 of
    // them.
    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );

    expect(counted?.rows).toBe(5000);
    expect(report).toEqual([
      {
        ruleId: 'R-BULK',
        version: 1,
        found: 5000,
        declined: 0,
        repeated: 0,
        written: 5000,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);

    // And the rows either side of the chunk boundary carry their own values,
    // not a neighbour's.
    const sampled = await patientRules.find({
      where: [
        { legacyId: 'P-B0000' },
        { legacyId: 'P-B4094' },
        { legacyId: 'P-B4095' },
        { legacyId: 'P-B4999' },
      ],
      order: { legacyId: 'ASC' },
    });

    expect(sampled.map((row) => [row.legacyId, row.previousValue, row.nextValue])).toEqual([
      ['P-B0000', '0610000000', '+31610000000'],
      ['P-B4094', '0610004094', '+31610004094'],
      ['P-B4095', '0610004095', '+31610004095'],
      ['P-B4999', '0610004999', '+31610004999'],
    ]);
  });

  it('reports counters that reconcile, for every rule version that ran', async () => {
    await patientRules.insert([
      {
        legacyId: 'P-1',
        ruleId: 'R-MIXED',
        version: 4,
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
        status: 'declined',
        reason: null,
      },
      {
        legacyId: 'P-2',
        ruleId: 'R-MIXED',
        version: 4,
        column: 'phone',
        previousValue: '0698765432',
        nextValue: '+31698765432',
        status: 'pending',
        reason: null,
      },
    ]);

    const report = await findings.persist([
      entry('R-MIXED', 4, [
        found('patient', 'P-1', 'phone', '0612345678', '+31612345678'),
        found('patient', 'P-2', 'phone', '0698765432', '+31698765432'),
        found('patient', 'P-3', 'phone', '0611223344', '+31611223344'),
      ]),
      entry('R-QUIET', 1, []),
    ]);

    // One entry per rule version that ran, empty responses included — the
    // runner keeps them (a rule that matched nothing is a fact about the run),
    // and so does this. The three outcomes account for every finding.
    expect(report).toEqual([
      {
        ruleId: 'R-MIXED',
        version: 4,
        found: 3,
        declined: 1,
        repeated: 1,
        written: 1,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
      {
        ruleId: 'R-QUIET',
        version: 1,
        found: 0,
        declined: 0,
        repeated: 0,
        written: 0,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);
    expect(reconciles(report)).toBe(true);
  });

  it('fails the whole call on a finding against a source table that does not exist', async () => {
    const failure: unknown = await findings
      .persist([
        entry('R-OK', 1, [found('patient', 'P-1', 'phone', '0612345678', '+31612345678')]),
        entry('R-BAD', 2, [
          found('somewhere-else' as LegacySourceTable, 'P-1', 'phone', '06', '+316'),
        ]),
      ])
      .catch((error: unknown) => error);

    // A finding nobody can place is a finding that would be silently lost, so
    // it is loud instead. The classification happens before any write and the
    // whole persist is one transaction, so the valid finding that came first is
    // not left behind as half a findings set.
    expect(failure).toBeInstanceOf(UnknownSourceTableError);
    expect(failure).toMatchObject({ ruleId: 'R-BAD', version: 2, table: 'somewhere-else' });

    for (const table of ['legacy_patient_rule', 'legacy_intake_rule', 'legacy_consent_rule']) {
      const [counted] = await dataSource.query<{ rows: number }[]>(
        `SELECT COUNT(*) AS rows FROM ${table}`,
      );

      expect(counted?.rows).toBe(0);
    }
  });

  it('writes rule rows and touches nothing else', async () => {
    await dataSource.getRepository(Rule).insert({
      ruleId: 'R-WRITES',
      ruleName: 'phone format',
      description: 'Dutch mobile numbers in international form',
      ambiguous: false,
    });
    await dataSource.getRepository(RuleVersion).insert({ ruleId: 'R-WRITES', version: 1 });
    await dataSource.getRepository(LegacyPatient).insert({
      legacyPatientId: 'P-1',
      fullName: 'Ana de Vries',
      phone: '0612345678',
      rawData: '{"id":"P-1"}',
    });
    await dataSource.getRepository(LegacyIntake).insert({
      legacyIntakeId: 'I-900',
      legacyPatientId: 'P-1',
      weight: '82kg',
      rawData: '{"id":"I-900"}',
    });
    await dataSource.getRepository(LegacyConsent).insert({
      legacyPatientId: 'P-1',
      type: 'marketing',
      at: '2021/03/04',
      rawData: '{"id":"P-1"}',
    });

    const untouched = ['rule', 'rule_version', 'legacy_patient', 'legacy_intake', 'legacy_consent'];
    const before: Record<string, StoredRow[]> = {};

    for (const table of untouched) {
      before[table] = await dataSource.query<StoredRow[]>(`SELECT * FROM ${table}`);
    }

    const report = await findings.persist([
      entry('R-WRITES', 1, [
        found('patient', 'P-1', 'phone', '0612345678', '+31612345678'),
        found('intake', 'I-900', 'weight', '82kg', '82'),
        found('consent', 'P-1', 'at', '2021/03/04', '2021-03-04'),
      ]),
    ]);

    // The comparison has something to compare: findings were written against
    // the very columns of the very rows seeded above.
    expect(report).toEqual([
      {
        ruleId: 'R-WRITES',
        version: 1,
        found: 3,
        declined: 0,
        repeated: 0,
        written: 3,
        linksFound: 0,
        linksRecorded: 0,
        linksSkipped: 0,
      },
    ]);

    // 1.1.3 draws the line here. Persisting a finding records what a rule
    // proposes; changing the data and closing the rule row is the apply
    // transaction (1.2.5), and no part of it happens on this path.
    for (const table of untouched) {
      expect(await dataSource.query<StoredRow[]>(`SELECT * FROM ${table}`)).toEqual(before[table]);
    }
  });

  it('records a duplicate link as pending, in the same transaction as the findings', async () => {
    const report = await findings.persist([
      entry(
        'D01',
        1,
        [found('patient', 'P-1', 'email', 'ana@old.example', 'ana@new.example')],
        false,
        [duplicate('patient', 'P-450', 'P-100', 'row-450', 'row-100')],
      ),
    ]);

    // 1.7.2's first scenario: the link lands beside the finding from the same
    // response, in the one transaction `persist` already runs in.
    expect(await linksOf(duplicates)).toEqual([
      {
        id: expect.any(String),
        sourceTable: 'patient',
        duplicateLegacyId: 'P-450',
        duplicateRowId: 'row-450',
        canonicalLegacyId: 'P-100',
        canonicalRowId: 'row-100',
        ruleId: 'D01',
        version: 1,
        status: 'pending',
      },
    ]);
    expect(await rowsOf(patientRules)).toHaveLength(1);
    expect(report).toEqual([
      {
        ruleId: 'D01',
        version: 1,
        found: 1,
        declined: 0,
        repeated: 0,
        written: 1,
        linksFound: 1,
        linksRecorded: 1,
        linksSkipped: 0,
      },
    ]);
  });

  it('records nothing when the same pair of rows is linked again', async () => {
    const link = duplicate('patient', 'P-450', 'P-100', 'row-450', 'row-100');

    await findings.persist([entry('D01', 1, [], false, [link])]);
    const second = await findings.persist([entry('D01', 1, [], false, [link])]);

    // 1.7.2's second scenario. One row, not two, and the report says why:
    // every finding was skipped, none recorded.
    expect(await linksOf(duplicates)).toHaveLength(1);
    expect(second).toEqual([
      {
        ruleId: 'D01',
        version: 1,
        found: 0,
        declined: 0,
        repeated: 0,
        written: 0,
        linksFound: 1,
        linksRecorded: 0,
        linksSkipped: 1,
      },
    ]);
  });

  it('records nothing when a dismissed pair is found again by a different rule, at any version', async () => {
    await duplicates.insert({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-450',
      duplicateRowId: 'row-450',
      canonicalLegacyId: 'P-100',
      canonicalRowId: 'row-100',
      ruleId: 'D01',
      version: 1,
      status: 'dismissed',
    });

    const report = await findings.persist([
      entry('D02', 3, [], false, [duplicate('patient', 'P-450', 'P-100', 'row-450', 'row-100')]),
    ]);

    // 1.7.2's third scenario: the skip is on the pair, not on which rule or
    // version last looked at it, so the dismissed row is left exactly as it
    // was and no second row appears beside it.
    expect(await linksOf(duplicates)).toEqual([
      expect.objectContaining({ ruleId: 'D01', version: 1, status: 'dismissed' }),
    ]);
    expect(report).toEqual([
      {
        ruleId: 'D02',
        version: 3,
        found: 0,
        declined: 0,
        repeated: 0,
        written: 0,
        linksFound: 1,
        linksRecorded: 0,
        linksSkipped: 1,
      },
    ]);
  });

  it('fails the whole call on a duplicate finding missing a row id, and writes no finding either', async () => {
    const failure: unknown = await findings
      .persist([
        entry('R-OK', 1, [found('patient', 'P-1', 'phone', '0612345678', '+31612345678')]),
        entry('D-BAD', 1, [], false, [
          duplicate('patient', 'P-450', 'P-100', undefined, 'row-100'),
        ]),
      ])
      .catch((error: unknown) => error);

    // 1.7.1: a link without both row ids identifies nothing, so it fails the
    // whole call the same way an unknown source table does — before any write,
    // atomically, in one transaction — and takes the valid finding that came
    // first down with it.
    expect(failure).toBeInstanceOf(DuplicateLinkMissingRowIdError);
    expect(failure).toMatchObject({
      ruleId: 'D-BAD',
      version: 1,
      table: 'patient',
      duplicateLegacyId: 'P-450',
      canonicalLegacyId: 'P-100',
    });

    for (const table of [
      'legacy_patient_rule',
      'legacy_intake_rule',
      'legacy_consent_rule',
      'duplicate',
    ]) {
      const [counted] = await dataSource.query<{ rows: number }[]>(
        `SELECT COUNT(*) AS rows FROM ${table}`,
      );

      expect(counted?.rows).toBe(0);
    }
  });
});
