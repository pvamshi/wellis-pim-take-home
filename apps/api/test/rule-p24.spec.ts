import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p24 } from '../src/rules/catalogue/p24';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P24 — a patient `sex` holding a value that is none of the spellings this
 * export is known to use, against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 35;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P24 — a patient sex nobody recognises', () => {
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
      // What the rule is for. A free-text column collected whatever was typed,
      // and none of these is a spelling the register can read.
      { legacyPatientId: 'p-onbekend', sex: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-unknown', sex: 'unknown', rawData: '{}' },
      { legacyPatientId: 'p-other', sex: 'other', rawData: '{}' },
      { legacyPatientId: 'p-nonbinary', sex: 'non-binary', rawData: '{}' },
      { legacyPatientId: 'p-intersex', sex: 'Intersex', rawData: '{}' },
      { legacyPatientId: 'p-x', sex: 'X', rawData: '{}' },
      { legacyPatientId: 'p-one', sex: '1', rawData: '{}' },
      { legacyPatientId: 'p-zero', sex: '0', rawData: '{}' },
      { legacyPatientId: 'p-dash', sex: '-', rawData: '{}' },
      { legacyPatientId: 'p-question', sex: '?', rawData: '{}' },
      { legacyPatientId: 'p-nvt', sex: 'n.v.t.', rawData: '{}' },
      { legacyPatientId: 'p-both', sex: 'M/F', rawData: '{}' },
      { legacyPatientId: 'p-bothcomma', sex: 'm, f', rawData: '{}' },
      { legacyPatientId: 'p-sentence', sex: 'prefers not to say', rawData: '{}' },

      // The rows that matter most: a value that resembles a recognised spelling
      // is still a value nobody recognises. The lookup is on the whole cell, so
      // none of these is quietly read as the word it starts with or contains —
      // `woman` guessed as `man` would put the opposite sex on the record.
      { legacyPatientId: 'p-woman', sex: 'woman', rawData: '{}' },
      { legacyPatientId: 'p-mannelijk', sex: 'mannelijk', rawData: '{}' },
      { legacyPatientId: 'p-vrouwelijk', sex: 'vrouwelijk', rawData: '{}' },
      { legacyPatientId: 'p-mstop', sex: 'M.', rawData: '{}' },
      { legacyPatientId: 'p-males', sex: 'males', rawData: '{}' },
      { legacyPatientId: 'p-manwithsuffix', sex: 'man?', rawData: '{}' },

      // Unrecognised and padded. The cell is reported exactly as stored, so the
      // human sees what the row actually holds.
      { legacyPatientId: 'p-paddedunknown', sex: '  onbekend  ', rawData: '{}' },
      { legacyPatientId: 'p-tabunknown', sex: '\tzzz', rawData: '{}' },

      // Left alone: recognised spellings, which are P23's business — the
      // canonical pair it produces, and the nine other spellings it rewrites,
      // in any capitals and with any padding.
      { legacyPatientId: 'p-canonicalmale', sex: 'M', rawData: '{}' },
      { legacyPatientId: 'p-canonicalfemale', sex: 'F', rawData: '{}' },
      { legacyPatientId: 'p-mlower', sex: 'm', rawData: '{}' },
      { legacyPatientId: 'p-male', sex: 'male', rawData: '{}' },
      { legacyPatientId: 'p-maleupper', sex: 'MALE', rawData: '{}' },
      { legacyPatientId: 'p-man', sex: 'man', rawData: '{}' },
      { legacyPatientId: 'p-vrouw', sex: 'Vrouw', rawData: '{}' },
      { legacyPatientId: 'p-vupper', sex: 'V', rawData: '{}' },
      { legacyPatientId: 'p-paddedmale', sex: '  Male  ', rawData: '{}' },

      // Left alone: no value in the column at all, which is P25's finding — a
      // cell of spaces included, since it trims to nothing.
      { legacyPatientId: 'p-empty', sex: '', rawData: '{}' },
      { legacyPatientId: 'p-blank', sex: '   ', rawData: '{}' },
      { legacyPatientId: 'p-null', sex: null, rawData: '{}' },

      // Left alone: unreadable values in other columns entirely. This rule
      // tests one column (1.1.5), and this row's sex is recognised — the padded
      // legacy id is P01's.
      {
        legacyPatientId: ' p-othercolumn ',
        sex: 'F',
        fullName: 'onbekend',
        status: 'zzz',
        weightUnit: 'stone',
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

  it('reports every sex that is not a recognised spelling, and nothing else', async () => {
    const response = await p24.run(context);

    // One call, every row (1.1.14). `prev` is the cell verbatim — padding,
    // capitals and all — because working out what the value meant is the whole
    // of the human's job here, and `column` is the column that was tested
    // (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      { table: 'patient', legacyId: 'p-both', column: 'sex', prev: 'M/F', next: null },
      { table: 'patient', legacyId: 'p-bothcomma', column: 'sex', prev: 'm, f', next: null },
      { table: 'patient', legacyId: 'p-dash', column: 'sex', prev: '-', next: null },
      { table: 'patient', legacyId: 'p-intersex', column: 'sex', prev: 'Intersex', next: null },
      { table: 'patient', legacyId: 'p-males', column: 'sex', prev: 'males', next: null },
      // Close to `man` without being it: the lookup is on the whole cell.
      { table: 'patient', legacyId: 'p-mannelijk', column: 'sex', prev: 'mannelijk', next: null },
      { table: 'patient', legacyId: 'p-manwithsuffix', column: 'sex', prev: 'man?', next: null },
      { table: 'patient', legacyId: 'p-mstop', column: 'sex', prev: 'M.', next: null },
      { table: 'patient', legacyId: 'p-nonbinary', column: 'sex', prev: 'non-binary', next: null },
      { table: 'patient', legacyId: 'p-nvt', column: 'sex', prev: 'n.v.t.', next: null },
      { table: 'patient', legacyId: 'p-onbekend', column: 'sex', prev: 'onbekend', next: null },
      { table: 'patient', legacyId: 'p-one', column: 'sex', prev: '1', next: null },
      { table: 'patient', legacyId: 'p-other', column: 'sex', prev: 'other', next: null },
      {
        table: 'patient',
        legacyId: 'p-paddedunknown',
        column: 'sex',
        // Padding is kept in what the human is shown, not trimmed away: the
        // trimming happens only to decide whether the value is recognised.
        prev: '  onbekend  ',
        next: null,
      },
      { table: 'patient', legacyId: 'p-question', column: 'sex', prev: '?', next: null },
      {
        table: 'patient',
        legacyId: 'p-sentence',
        column: 'sex',
        prev: 'prefers not to say',
        next: null,
      },
      { table: 'patient', legacyId: 'p-tabunknown', column: 'sex', prev: '\tzzz', next: null },
      { table: 'patient', legacyId: 'p-unknown', column: 'sex', prev: 'unknown', next: null },
      { table: 'patient', legacyId: 'p-vrouwelijk', column: 'sex', prev: 'vrouwelijk', next: null },
      // `woman` contains `man`, and reading it as one would write the opposite
      // sex onto the record. It is reported whole and asked about instead.
      { table: 'patient', legacyId: 'p-woman', column: 'sex', prev: 'woman', next: null },
      { table: 'patient', legacyId: 'p-x', column: 'sex', prev: 'X', next: null },
      { table: 'patient', legacyId: 'p-zero', column: 'sex', prev: '0', next: null },
    ]);
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p24.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `sex`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.sex).toBe(update.prev);
    }
  });

  it('leaves recognised spellings, empty cells and every other column alone', async () => {
    const response = await p24.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A spelling this export is known to use is P23's business, in any capitals
    // and with any padding — including the canonical `M` and `F`, which are
    // what the column is meant to hold. A row both rules matched would put two
    // findings in front of a human for one problem (1.1.4).
    expect(touched).not.toContain('p-canonicalmale');
    expect(touched).not.toContain('p-canonicalfemale');
    expect(touched).not.toContain('p-mlower');
    expect(touched).not.toContain('p-male');
    expect(touched).not.toContain('p-maleupper');
    expect(touched).not.toContain('p-man');
    expect(touched).not.toContain('p-vrouw');
    expect(touched).not.toContain('p-vupper');
    expect(touched).not.toContain('p-paddedmale');

    // No value in the column at all, which is P25's finding — the sentence for
    // that row is "this was never answered", not "this is unreadable".
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-null');

    // And no other column is reported against, whatever unreadable thing it
    // holds (1.1.5) — including the padded legacy id, which is P01's.
    expect(touched).not.toContain(' p-othercolumn ');
    for (const update of response.updates) {
      expect(update.column).toBe('sex');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p24.run(context);

    // The catalogue marks P24 ambiguous: an unrecognised value is not a near
    // miss to be corrected towards, and nothing else in the row says what it
    // was meant to be. The flag is rule-wide (1.1.12) — stated once beside the
    // updates — and the `rule` row says the same thing the response does, which
    // is what makes the description the human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p24.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p24]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P24', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once a recognised value is in the cell', async () => {
    const before = await p24.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-onbekend');

    // What resolving an ambiguous finding does: a human works out what the
    // value meant and writes a recognised one into the column the rule tested
    // (1.1.5). The rule is self-terminating — it tests what it reports on, so
    // the row does not come back.
    await patients.update({ legacyPatientId: 'p-onbekend' }, { sex: 'F' });

    const after = await p24.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-onbekend');

    await patients.update({ legacyPatientId: 'p-onbekend' }, { sex: 'onbekend' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p24.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — an unreadable sex quietly guessed at most of all.
    expect(before).toHaveLength(FIXTURE_ROWS);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P24 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p24);
    expect(p24.ruleId).toBe('P24');
    expect(p24.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p24.ruleName.length).toBeGreaterThan(0);
    expect(p24.description.length).toBeGreaterThan(0);
  });
});
