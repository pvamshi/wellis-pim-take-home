import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p26 } from '../src/rules/catalogue/p26';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P26 — a patient `bsn` grouped with spaces, dots or dashes, against a real
 * database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

/** A non-breaking space — named, because it is invisible where it is used below. */
const NBSP = ' ';

/** An en dash — a typographic mark, and not the hyphen the catalogue names. */
const EN_DASH = '–';

describe('P26 — a patient bsn with spaces, dots or dashes in it', () => {
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
      // The three marks the catalogue names, each grouping the same nine
      // digits the way somebody typing them would.
      { legacyPatientId: 'p-spaces', bsn: '123 456 789', rawData: '{}' },
      { legacyPatientId: 'p-dots', bsn: '123.456.789', rawData: '{}' },
      { legacyPatientId: 'p-dashes', bsn: '123-456-789', rawData: '{}' },
      { legacyPatientId: 'p-dutchgrouping', bsn: '1234-56-789', rawData: '{}' },
      { legacyPatientId: 'p-mixed', bsn: '1.23-45 678 9', rawData: '{}' },

      // Whitespace a spreadsheet writes that is not the space bar: a tab, and a
      // non-breaking space. Both are invisible to the reader and both are the
      // spaces the catalogue names.
      { legacyPatientId: 'p-tab', bsn: '123\t456\t789', rawData: '{}' },
      { legacyPatientId: 'p-nbsp', bsn: `123${NBSP}456${NBSP}789`, rawData: '{}' },

      // Padding around the number, and a separator with no digits after it.
      // This column has no whitespace rule of its own, so the ends go with the
      // middle — otherwise a padded BSN has no rule at all.
      { legacyPatientId: 'p-padded', bsn: '  123456789  ', rawData: '{}' },
      { legacyPatientId: 'p-trailingdash', bsn: '123456789-', rawData: '{}' },

      // A leading zero that survived the export, kept: the digits are proposed
      // in the order the cell had them and none is dropped.
      { legacyPatientId: 'p-leadingzero', bsn: '0 67 077 086', rawData: '{}' },

      // How many digits are left is not this rule's question. Eight digits is
      // the leading zero P27 pads back on, and four is a length P29 asks a
      // human about — both are cleaned here and judged there (1.1.4).
      { legacyPatientId: 'p-eightdigits', bsn: '1234-5678', rawData: '{}' },
      { legacyPatientId: 'p-short', bsn: '12 34', rawData: '{}' },

      // Left alone: already digits and nothing else, so there is nothing to
      // propose and nothing for a human to approve.
      { legacyPatientId: 'p-clean', bsn: '123456789', rawData: '{}' },
      { legacyPatientId: 'p-cleanzero', bsn: '067077086', rawData: '{}' },

      // Left alone: no value in the column at all, and cells that clean away to
      // nothing. A rule whose fix is "the digits alone" cannot propose an empty
      // BSN; the wrong length after cleaning is P29's finding.
      { legacyPatientId: 'p-null', bsn: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', bsn: '', rawData: '{}' },
      { legacyPatientId: 'p-blank', bsn: '   ', rawData: '{}' },
      { legacyPatientId: 'p-dashonly', bsn: '-', rawData: '{}' },
      { legacyPatientId: 'p-dotsonly', bsn: '...', rawData: '{}' },

      // Left alone, and these are the rows that matter most: a letter anywhere
      // in the cell. Removing the separators and proposing what is left would
      // hand on a number with a character quietly dropped out of it — P29
      // reports the cell whole instead.
      { legacyPatientId: 'p-letterinside', bsn: '12-34X6789', rawData: '{}' },
      { legacyPatientId: 'p-notapplicable', bsn: 'n.v.t.', rawData: '{}' },
      { legacyPatientId: 'p-word', bsn: 'onbekend', rawData: '{}' },

      // Left alone: marks the catalogue did not name. Each hints at a cell
      // holding something other than a grouped BSN — a date, a decimal, a
      // phone number, a typographic dash nobody typed on purpose.
      { legacyPatientId: 'p-slash', bsn: '123/456789', rawData: '{}' },
      { legacyPatientId: 'p-comma', bsn: '123,456,789', rawData: '{}' },
      { legacyPatientId: 'p-underscore', bsn: '123_456_789', rawData: '{}' },
      { legacyPatientId: 'p-parens', bsn: '(123)456789', rawData: '{}' },
      { legacyPatientId: 'p-plus', bsn: '+31612345678', rawData: '{}' },
      { legacyPatientId: 'p-endash', bsn: `123${EN_DASH}456${EN_DASH}789`, rawData: '{}' },

      // Left alone: separators spelled into other columns entirely. P26 tests
      // one column (1.1.5) — a grouped phone is P30's, a comma decimal P41's,
      // a dotted date P17's — and this row's bsn is already clean.
      {
        legacyPatientId: 'p-othercolumn',
        bsn: '123456789',
        phone: '06 12 34 56 78',
        weight: '82,5',
        dob: '03.07.1984',
        fullName: 'Jan  Jansen',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // bsn here is already clean.
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

  it('proposes the digits alone for every grouped number', async () => {
    const response = await p26.run(context);

    // The value matters, not just that the rule fired: each `next` is the same
    // digits in the same order with the punctuation gone — no digit added,
    // dropped or reordered, and no length judged. One call, every row (1.1.14),
    // and `column` is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-dashes',
        column: 'bsn',
        prev: '123-456-789',
        next: '123456789',
      },
      {
        table: 'patient',
        legacyId: 'p-dots',
        column: 'bsn',
        prev: '123.456.789',
        next: '123456789',
      },
      {
        table: 'patient',
        legacyId: 'p-dutchgrouping',
        column: 'bsn',
        prev: '1234-56-789',
        next: '123456789',
      },
      {
        table: 'patient',
        legacyId: 'p-eightdigits',
        column: 'bsn',
        prev: '1234-5678',
        // Eight digits, proposed as eight digits. The missing leading zero is
        // P27's fix, and this rule does not reach for it.
        next: '12345678',
      },
      {
        table: 'patient',
        legacyId: 'p-leadingzero',
        column: 'bsn',
        prev: '0 67 077 086',
        // The leading zero the cell had is a digit like any other.
        next: '067077086',
      },
      {
        table: 'patient',
        legacyId: 'p-mixed',
        column: 'bsn',
        prev: '1.23-45 678 9',
        // All three marks in one cell, and the digits come out in order.
        next: '123456789',
      },
      {
        table: 'patient',
        legacyId: 'p-nbsp',
        column: 'bsn',
        prev: `123${NBSP}456${NBSP}789`,
        next: '123456789',
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'bsn',
        prev: '  123456789  ',
        // Padding at the ends goes with the separators inside: the whole cell
        // becomes the digits it held.
        next: '123456789',
      },
      {
        table: 'patient',
        legacyId: 'p-short',
        column: 'bsn',
        prev: '12 34',
        // Four digits is not a BSN, and saying so is P29's finding. Cleaning
        // the cell is still this rule's fix.
        next: '1234',
      },
      {
        table: 'patient',
        legacyId: 'p-spaces',
        column: 'bsn',
        prev: '123 456 789',
        next: '123456789',
      },
      {
        table: 'patient',
        legacyId: 'p-tab',
        column: 'bsn',
        prev: '123\t456\t789',
        next: '123456789',
      },
      {
        table: 'patient',
        legacyId: 'p-trailingdash',
        column: 'bsn',
        prev: '123456789-',
        next: '123456789',
      },
    ]);
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p26.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `bsn`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.bsn).toBe(update.prev);
    }
  });

  it('leaves clean numbers, letters, other marks and every other cell alone', async () => {
    const response = await p26.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Already what this rule produces, so there is nothing to propose.
    expect(touched).not.toContain('p-clean');
    expect(touched).not.toContain('p-cleanzero');

    // No digits to propose once the separators are gone. P29 reports these.
    expect(touched).not.toContain('p-null');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-dashonly');
    expect(touched).not.toContain('p-dotsonly');

    // A letter anywhere in the cell: the rule never strips what it does not
    // name, so a letter survives the removal and sends the row to P29 whole.
    expect(touched).not.toContain('p-letterinside');
    expect(touched).not.toContain('p-notapplicable');
    expect(touched).not.toContain('p-word');

    // Marks the catalogue did not name.
    expect(touched).not.toContain('p-slash');
    expect(touched).not.toContain('p-comma');
    expect(touched).not.toContain('p-underscore');
    expect(touched).not.toContain('p-parens');
    expect(touched).not.toContain('p-plus');
    expect(touched).not.toContain('p-endash');

    // And no other column is proposed against, however it is grouped (1.1.5) —
    // including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-othercolumn');
    expect(touched).not.toContain(' p-paddedid ');
    for (const update of response.updates) {
      expect(update.column).toBe('bsn');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries the digits it read', async () => {
    const response = await p26.run(context);

    // The catalogue does not mark P26 ambiguous: a separator carries no
    // information, so removing it is reading the cell rather than guessing at
    // it. The flag is rule-wide (1.1.12), stated once beside the updates, and
    // the `rule` row says the same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p26.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      // Never a proposal with nothing in it: a cell already holding bare digits
      // is walked past rather than reported unchanged.
      expect(update.next).not.toBe(update.prev);

      const proposed = update.next ?? '';
      const previous = update.prev ?? '';

      // Digits, and nothing else, in the order the cell had them — which is the
      // whole of what "the digits alone" means. Every digit of the old value is
      // in the new one, and no digit that was not.
      expect(proposed).toMatch(/^[0-9]+$/);
      expect(proposed).toBe(previous.replace(/[\s.-]/g, ''));
      expect([...previous].filter((character) => /[0-9]/.test(character)).join('')).toBe(proposed);
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p26.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-dashes');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). What it proposes holds no separator, so the rule is
    // self-terminating and the applied row needs no guard to keep it from being
    // re-proposed.
    await patients.update({ legacyPatientId: 'p-dashes' }, { bsn: '123456789' });

    const after = await p26.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-dashes');

    await patients.update({ legacyPatientId: 'p-dashes' }, { bsn: '123-456-789' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p26.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(30);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P26 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p26);
    expect(p26.ruleId).toBe('P26');
    expect(p26.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p26.ruleName.length).toBeGreaterThan(0);
    expect(p26.description.length).toBeGreaterThan(0);
  });
});
