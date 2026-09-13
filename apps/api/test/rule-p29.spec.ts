import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p29 } from '../src/rules/catalogue/p29';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P29 — a patient `bsn` with letters in it, or the wrong number of digits once
 * the grouping is taken out, against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 30;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

/**
 * The catalogue's test, written out again here rather than imported from the
 * rule: take out the spaces, dots and dashes a typist groups digits with, and
 * what is left must be the eight or nine digits this column's other rules can
 * read. A test that reused the rule's own regular expressions would agree with
 * it whatever they matched.
 */
function isReadableAsDigits(value: string): boolean {
  return /^[0-9]{8,9}$/.test(value.replace(/[\s.-]/g, ''));
}

describe('P29 — a patient bsn with letters or the wrong number of digits', () => {
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
      // Letters: a word instead of a number, a note, and a letter sitting among
      // the digits where a key was mistyped.
      { legacyPatientId: 'p-word', bsn: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-note', bsn: 'zie dossier', rawData: '{}' },
      { legacyPatientId: 'p-letter-inside', bsn: '1234X6789', rawData: '{}' },
      { legacyPatientId: 'p-letter-suffix', bsn: '123456789X', rawData: '{}' },
      // Nine digits with a label typed in front of them. The digits are there
      // and the cell still is not a BSN — this rule never reads around text to
      // find a number inside it.
      { legacyPatientId: 'p-labelled', bsn: 'bsn 123456789', rawData: '{}' },

      // The wrong length: too few digits, too many, and a single digit.
      { legacyPatientId: 'p-seven', bsn: '1234567', rawData: '{}' },
      { legacyPatientId: 'p-ten', bsn: '1234567890', rawData: '{}' },
      { legacyPatientId: 'p-one', bsn: '5', rawData: '{}' },

      // Marks that are not the spaces, dots and dashes P26 removes. Each hints
      // at a cell holding something other than a grouped BSN, and each survives
      // the cleaning, so what is left is not digits.
      { legacyPatientId: 'p-slash', bsn: '123/456789', rawData: '{}' },
      { legacyPatientId: 'p-comma', bsn: '123,456,789', rawData: '{}' },
      { legacyPatientId: 'p-bracket', bsn: '(123)456789', rawData: '{}' },
      { legacyPatientId: 'p-plus', bsn: '+31612345678', rawData: '{}' },
      // A typographic dash is not read as a hyphen, so this cell cleans to
      // itself and is reported rather than silently treated as punctuation.
      { legacyPatientId: 'p-emdash', bsn: '—', rawData: '{}' },

      // Somebody writing "there isn't one". Characters were typed into the
      // cell, so there is an answer here to put in front of a human — unlike a
      // cell nobody ever filled in.
      { legacyPatientId: 'p-dash-only', bsn: '--', rawData: '{}' },
      { legacyPatientId: 'p-nvt', bsn: 'n.v.t.', rawData: '{}' },
      { legacyPatientId: 'p-question', bsn: '?', rawData: '{}' },

      // Left alone: nine digits, which is the length a BSN is. Whether those
      // nine are a real one is P28's question, not this rule's.
      { legacyPatientId: 'p-nine', bsn: '123456789', rawData: '{}' },
      { legacyPatientId: 'p-nine-zeros', bsn: '000000000', rawData: '{}' },

      // Left alone: eight digits are a leading zero a spreadsheet ate, which
      // P27 pads back. Not a wrong length — a length with its own rule.
      { legacyPatientId: 'p-eight', bsn: '67077086', rawData: '{}' },

      // Left alone: nine digits under grouping or padding. P26 proposes the
      // digits alone and this rule reads the result on the next run.
      { legacyPatientId: 'p-grouped', bsn: '123 456 789', rawData: '{}' },
      { legacyPatientId: 'p-dotted', bsn: '123.456.789', rawData: '{}' },
      { legacyPatientId: 'p-dashed', bsn: '1234-56-789', rawData: '{}' },
      { legacyPatientId: 'p-padded', bsn: '  123456789  ', rawData: '{}' },

      // Left alone, and this is what proves "after cleaning" is P26's cleaning
      // and not this rule's: both of these clean to the wrong length, and both
      // are P26's fix this run. Reporting them here would put two findings on
      // one cell in one batch (1.1.4).
      { legacyPatientId: 'p-grouped-seven', bsn: '123 4567', rawData: '{}' },
      { legacyPatientId: 'p-grouped-ten', bsn: '123 456 789 0', rawData: '{}' },

      // Left alone: no value in the cell at all. The catalogue gives `bsn` no
      // empty rule — the field was hidden from the form, so a patient with no
      // BSN is the ordinary case — and all three of these read as the same
      // blank to whoever opens the row.
      { legacyPatientId: 'p-null', bsn: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', bsn: '', rawData: '{}' },
      { legacyPatientId: 'p-blank', bsn: '        ', rawData: '{}' },

      // Left alone: words and wrong lengths sitting in other columns entirely.
      // P29 tests one column (1.1.5), and this row's bsn is nine digits.
      {
        legacyPatientId: 'p-othercolumn',
        bsn: '123456789',
        phone: 'onbekend',
        dob: '1234567',
        weight: '—',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // bsn here is nine digits.
      { legacyPatientId: ' p-paddedid ', bsn: '123456789', rawData: '{}' },
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

  it('reports every bsn that is not eight or nine digits after cleaning, and nothing else', async () => {
    const response = await p29.run(context);

    // One call, every row (1.1.14). `prev` is the cell verbatim so the human
    // sees what the row holds, `next` is null throughout (1.1.12), and `column`
    // is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      { table: 'patient', legacyId: 'p-bracket', column: 'bsn', prev: '(123)456789', next: null },
      { table: 'patient', legacyId: 'p-comma', column: 'bsn', prev: '123,456,789', next: null },
      { table: 'patient', legacyId: 'p-dash-only', column: 'bsn', prev: '--', next: null },
      { table: 'patient', legacyId: 'p-emdash', column: 'bsn', prev: '—', next: null },
      {
        table: 'patient',
        legacyId: 'p-labelled',
        column: 'bsn',
        prev: 'bsn 123456789',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-letter-inside',
        column: 'bsn',
        prev: '1234X6789',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-letter-suffix',
        column: 'bsn',
        prev: '123456789X',
        next: null,
      },
      { table: 'patient', legacyId: 'p-note', column: 'bsn', prev: 'zie dossier', next: null },
      { table: 'patient', legacyId: 'p-nvt', column: 'bsn', prev: 'n.v.t.', next: null },
      { table: 'patient', legacyId: 'p-one', column: 'bsn', prev: '5', next: null },
      { table: 'patient', legacyId: 'p-plus', column: 'bsn', prev: '+31612345678', next: null },
      { table: 'patient', legacyId: 'p-question', column: 'bsn', prev: '?', next: null },
      { table: 'patient', legacyId: 'p-seven', column: 'bsn', prev: '1234567', next: null },
      { table: 'patient', legacyId: 'p-slash', column: 'bsn', prev: '123/456789', next: null },
      { table: 'patient', legacyId: 'p-ten', column: 'bsn', prev: '1234567890', next: null },
      { table: 'patient', legacyId: 'p-word', column: 'bsn', prev: 'onbekend', next: null },
    ]);
  });

  it('is the catalogue test — letters, or a length that is neither eight nor nine', async () => {
    const response = await p29.run(context);

    // Every reported cell, measured against the test written independently of
    // the rule: strip the grouping, and what is left is not eight or nine
    // digits. A letter fails this the same way a seventh or a tenth digit does,
    // which is why both halves of the catalogue entry are one finding.
    for (const update of response.updates) {
      expect(isReadableAsDigits(update.prev ?? '')).toBe(false);
    }

    // And the other side of it: every fixture the rule walked past is either a
    // cell with no value in it, a cell P26 cleans into digits first, or already
    // eight or nine digits. Nothing unreadable was missed.
    const touched = new Set(response.updates.map((update) => update.legacyId));
    const stored = await patients.find();

    for (const patient of stored) {
      const value = patient.bsn;

      if (touched.has(patient.legacyPatientId) || value === null || value.trim().length === 0) {
        continue;
      }

      const cleaned = value.replace(/[\s.-]/g, '');
      const cleanedByP26 = /^[0-9]+$/.test(cleaned) && cleaned !== value;

      expect(isReadableAsDigits(value) || cleanedByP26).toBe(true);
    }
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p29.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `bsn`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.bsn).toBe(update.prev);
    }
  });

  it('leaves the lengths and shapes the other bsn rules own alone', async () => {
    const response = await p29.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Nine digits is the length a BSN is; whether the number is real is P28's.
    expect(touched).not.toContain('p-nine');
    expect(touched).not.toContain('p-nine-zeros');

    // Eight digits is a BSN missing the zero a spreadsheet ate, which P27 pads.
    expect(touched).not.toContain('p-eight');

    // Grouped or padded digits are P26's fix first, and this rule reads the
    // cleaned value on the next run.
    expect(touched).not.toContain('p-grouped');
    expect(touched).not.toContain('p-dotted');
    expect(touched).not.toContain('p-dashed');
    expect(touched).not.toContain('p-padded');
    expect(touched).not.toContain('p-grouped-seven');
    expect(touched).not.toContain('p-grouped-ten');

    // And no other column is reported against, however unreadable its value
    // (1.1.5) — including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-othercolumn');
    expect(touched).not.toContain(' p-paddedid ');
    for (const update of response.updates) {
      expect(update.column).toBe('bsn');
      expect(update.table).toBe('patient');
    }
  });

  it('leaves a cell with no value in it alone', async () => {
    const response = await p29.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // The catalogue gives `bsn` no empty rule, and it is the only patient
    // column with none: the field was collected for the insurance experiments
    // and then hidden from the form, so a patient with no BSN is the ordinary
    // case and there is nothing for a human to decide. Absent, empty and
    // whitespace-only all read as the same blank and are treated as one.
    expect(touched).not.toContain('p-null');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-blank');

    // A mark somebody typed is not an absence, and is reported: the human
    // either replaces it with the number or clears it.
    expect(touched).toContain('p-dash-only');
    expect(touched).toContain('p-question');
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p29.run(context);

    // The catalogue marks P29 ambiguous: what is in the cell does not contain
    // the number, nothing else in the row holds it, and adding or removing a
    // digit to make the count come out would invent a citizen service number
    // that belongs to somebody else. The flag is rule-wide (1.1.12) — stated
    // once beside the updates — and the `rule` row says the same thing the
    // response does, which is what makes the description the human's only
    // explanation.
    expect(response.ambiguity).toBe(true);
    expect(p29.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p29]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P29', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once the number is in the cell, or the cell is cleared', async () => {
    const before = await p29.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-word');
    expect(before.updates.map((update) => update.legacyId)).toContain('p-seven');

    // What resolving an ambiguous finding does: a human writes the real number
    // into the column the rule tested (1.1.5), or — where there never was one —
    // takes the text out. The rule is self-terminating either way, because it
    // tests what it reports on.
    await patients.update({ legacyPatientId: 'p-word' }, { bsn: '123456789' });
    await patients.update({ legacyPatientId: 'p-seven' }, { bsn: null });

    const after = await p29.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-word');
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-seven');

    await patients.update({ legacyPatientId: 'p-word' }, { bsn: 'onbekend' });
    await patients.update({ legacyPatientId: 'p-seven' }, { bsn: '1234567' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p29.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — a cell quietly "cleaned" into digits most of all.
    expect(before).toHaveLength(FIXTURE_ROWS);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P29 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p29);
    expect(p29.ruleId).toBe('P29');
    expect(p29.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), and
    // for an ambiguous rule it is the whole explanation, since there is no
    // proposed value to show.
    expect(p29.ruleName.length).toBeGreaterThan(0);
    expect(p29.description.length).toBeGreaterThan(0);
  });
});
