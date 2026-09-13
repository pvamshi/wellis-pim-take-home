import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p25 } from '../src/rules/catalogue/p25';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P25 — a patient row with no `sex` in it at all, against a real database with
 * real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 24;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P25 — a patient sex that is empty', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let patients: Repository<LegacyPatient>;
  let context: RuleContext;

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    // Booting is what creates the tables: `synchronize: true` and no migration
    // step to stand in for it (tech-stack 4.4).
    await app.init();
    dataSource = moduleRef.get(DataSource);
    patients = dataSource.getRepository(LegacyPatient);
    context = createRuleContext(dataSource.manager);

    await patients.save([
      // What the rule is for. Three ways a cell arrives with nothing in it: an
      // empty cell, an absent column, and whitespace somebody typed.
      { legacyPatientId: 'p-empty', sex: '', rawData: '{}' },
      { legacyPatientId: 'p-null', sex: null, rawData: '{}' },
      { legacyPatientId: 'p-space', sex: ' ', rawData: '{}' },
      { legacyPatientId: 'p-spaces', sex: '   ', rawData: '{}' },
      { legacyPatientId: 'p-tab', sex: '\t', rawData: '{}' },
      { legacyPatientId: 'p-newline', sex: '\n', rawData: '{}' },
      { legacyPatientId: 'p-mixedblank', sex: ' \t \n ', rawData: '{}' },

      // Left alone: a spelling this export is known to use, in any capitals and
      // with any padding. Either it is already canonical or P23 makes it so —
      // there is an answer in the cell, whatever shape it is written in.
      { legacyPatientId: 'p-canonicalmale', sex: 'M', rawData: '{}' },
      { legacyPatientId: 'p-canonicalfemale', sex: 'F', rawData: '{}' },
      { legacyPatientId: 'p-mlower', sex: 'm', rawData: '{}' },
      { legacyPatientId: 'p-male', sex: 'male', rawData: '{}' },
      { legacyPatientId: 'p-maleupper', sex: 'MALE', rawData: '{}' },
      { legacyPatientId: 'p-man', sex: 'man', rawData: '{}' },
      { legacyPatientId: 'p-vrouw', sex: 'Vrouw', rawData: '{}' },
      { legacyPatientId: 'p-vupper', sex: 'V', rawData: '{}' },
      // Padded, not empty: trimming it leaves a spelling behind.
      { legacyPatientId: 'p-paddedmale', sex: '  Male  ', rawData: '{}' },

      // Left alone: a value nobody recognises, which is P24's finding. The
      // filler characters matter most here — `-`, `?`, `n.v.t.` and `0` look
      // like nothing to a reader, but they are characters in the cell, and
      // deciding on our own which marks mean "empty" would be a guess.
      { legacyPatientId: 'p-onbekend', sex: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-x', sex: 'X', rawData: '{}' },
      { legacyPatientId: 'p-mannelijk', sex: 'mannelijk', rawData: '{}' },
      { legacyPatientId: 'p-dash', sex: '-', rawData: '{}' },
      { legacyPatientId: 'p-question', sex: '?', rawData: '{}' },
      { legacyPatientId: 'p-nvt', sex: 'n.v.t.', rawData: '{}' },
      { legacyPatientId: 'p-zero', sex: '0', rawData: '{}' },

      // Left alone: empty columns that are not this one. This rule tests one
      // column (1.1.5), and this row's sex is answered — the empty name is
      // P08's, the empty email P15's, the blank dob P22's, the empty phone
      // P36's and the padded legacy id P01's.
      {
        legacyPatientId: ' p-othercolumn ',
        sex: 'F',
        fullName: '',
        email: '   ',
        dob: '',
        phone: '',
        city: '',
        weight: '',
        weightUnit: '',
        status: '',
        rawData: '{}',
      },
    ]);
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

  it('reports every row with no sex in it, and nothing else', async () => {
    const response = await p25.run(context);

    // One call, every row (1.1.14). `prev` is the cell verbatim, so an absent
    // value, an empty one and a cell of whitespace stay distinguishable to the
    // human reading the row, and `column` is the column that was tested
    // (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      { table: 'patient', legacyId: 'p-empty', column: 'sex', prev: '', next: null },
      { table: 'patient', legacyId: 'p-mixedblank', column: 'sex', prev: ' \t \n ', next: null },
      { table: 'patient', legacyId: 'p-newline', column: 'sex', prev: '\n', next: null },
      // The column is nullable, and a source row that never had it lands here.
      { table: 'patient', legacyId: 'p-null', column: 'sex', prev: null, next: null },
      { table: 'patient', legacyId: 'p-space', column: 'sex', prev: ' ', next: null },
      { table: 'patient', legacyId: 'p-spaces', column: 'sex', prev: '   ', next: null },
      { table: 'patient', legacyId: 'p-tab', column: 'sex', prev: '\t', next: null },
    ]);
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p25.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `sex`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the nothing it reports as
    // `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.sex).toBe(update.prev);
    }
  });

  it('leaves every cell with something in it alone, and every other column', async () => {
    const response = await p25.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A recognised spelling is P23's business or already canonical, in any
    // capitals and with any padding — `  Male  ` is padded, not empty.
    expect(touched).not.toContain('p-canonicalmale');
    expect(touched).not.toContain('p-canonicalfemale');
    expect(touched).not.toContain('p-mlower');
    expect(touched).not.toContain('p-male');
    expect(touched).not.toContain('p-maleupper');
    expect(touched).not.toContain('p-man');
    expect(touched).not.toContain('p-vrouw');
    expect(touched).not.toContain('p-vupper');
    expect(touched).not.toContain('p-paddedmale');

    // A value nobody recognises is P24's finding, filler characters included: a
    // row both rules matched would put two findings in front of a human for one
    // problem (1.1.4).
    expect(touched).not.toContain('p-onbekend');
    expect(touched).not.toContain('p-x');
    expect(touched).not.toContain('p-mannelijk');
    expect(touched).not.toContain('p-dash');
    expect(touched).not.toContain('p-question');
    expect(touched).not.toContain('p-nvt');
    expect(touched).not.toContain('p-zero');

    // And no other column is reported against, however empty it is (1.1.5) —
    // including the padded legacy id, which is P01's.
    expect(touched).not.toContain(' p-othercolumn ');
    for (const update of response.updates) {
      expect(update.column).toBe('sex');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p25.run(context);

    // The catalogue marks P25 ambiguous: nothing else in the row states a sex,
    // there is no safe default to assume, and the blank may itself be the
    // truthful answer. The flag is rule-wide (1.1.12) — stated once beside the
    // updates — and the `rule` row says the same thing the response does, which
    // is what makes the description the human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p25.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p25]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P25', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once an answer is in the cell', async () => {
    const before = await p25.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-empty');

    // What resolving an ambiguous finding does: a human finds out what the
    // patient answered and writes it into the column the rule tested (1.1.5).
    // The rule is self-terminating — it tests what it reports on, so the row
    // does not come back.
    await patients.update({ legacyPatientId: 'p-empty' }, { sex: 'F' });

    const after = await p25.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-empty');

    await patients.update({ legacyPatientId: 'p-empty' }, { sex: '' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p25.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — an empty sex quietly filled in most of all.
    expect(before).toHaveLength(FIXTURE_ROWS);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P25 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p25);
    expect(p25.ruleId).toBe('P25');
    expect(p25.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p25.ruleName.length).toBeGreaterThan(0);
    expect(p25.description.length).toBeGreaterThan(0);
  });
});
