import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p30 } from '../src/rules/catalogue/p30';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P30 — a patient `phone` grouped with spaces, dots, dashes or brackets,
 * against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

/** A non-breaking space — named, because it is invisible where it is used below. */
const NBSP = ' ';

/** An en dash — a typographic mark, and not the hyphen the catalogue names. */
const EN_DASH = '–';

describe('P30 — a patient phone with spaces, dots, dashes or brackets in it', () => {
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
      // The four marks the catalogue names, each grouping the same mobile
      // number the way somebody writing it down would.
      { legacyPatientId: 'p-spaces', phone: '06 12 34 56 78', rawData: '{}' },
      { legacyPatientId: 'p-dots', phone: '06.12.34.56.78', rawData: '{}' },
      { legacyPatientId: 'p-dashes', phone: '06-12345678', rawData: '{}' },
      { legacyPatientId: 'p-parens', phone: '(020) 123 4567', rawData: '{}' },
      { legacyPatientId: 'p-squarebrackets', phone: '[020] 1234567', rawData: '{}' },
      { legacyPatientId: 'p-mixed', phone: '(06) 12-34.56 78', rawData: '{}' },
      { legacyPatientId: 'p-landline', phone: '020 123 4567', rawData: '{}' },

      // Whitespace a spreadsheet writes that is not the space bar: a tab, and a
      // non-breaking space. Both are invisible to the reader and both are the
      // spaces the catalogue names.
      { legacyPatientId: 'p-tab', phone: '06\t12345678', rawData: '{}' },
      { legacyPatientId: 'p-nbsp', phone: `06${NBSP}12345678`, rawData: '{}' },

      // Padding around the number, and a grouping mark with no digits after it.
      // This column has no whitespace rule of its own, so the ends go with the
      // middle — otherwise a padded number has no rule at all.
      { legacyPatientId: 'p-padded', phone: '  0612345678  ', rawData: '{}' },
      { legacyPatientId: 'p-trailingdash', phone: '0612345678-', rawData: '{}' },

      // A leading `+` is kept where it is: it is not grouping, it is how the
      // number says it carries a country code.
      { legacyPatientId: 'p-plusspaces', phone: '+31 6 1234 5678', rawData: '{}' },
      { legacyPatientId: 'p-plusdashes', phone: '+31-6-1234-5678', rawData: '{}' },

      // The international spelling with the trunk zero in brackets. The
      // brackets come out and the zero stays: dropping a digit is a second fix
      // (1.1.4), and the number this leaves is too long, which is P33's
      // finding and P33's sentence to a human.
      { legacyPatientId: 'p-trunkzero', phone: '+31 (0)6 12345678', rawData: '{}' },

      // What the digits add up to is not this rule's question. A `00` country
      // prefix is P31's, a short number and a placeholder are P33's and P35's —
      // all three are cleaned here and judged there (1.1.4).
      { legacyPatientId: 'p-doubleoh', phone: '00 31 6 1234 5678', rawData: '{}' },
      { legacyPatientId: 'p-short', phone: '06 12', rawData: '{}' },
      { legacyPatientId: 'p-placeholder', phone: '000 000 000', rawData: '{}' },

      // Left alone: already digits, with or without the leading `+`, so there
      // is nothing to propose and nothing for a human to approve.
      { legacyPatientId: 'p-clean', phone: '0612345678', rawData: '{}' },
      { legacyPatientId: 'p-cleanplus', phone: '+31612345678', rawData: '{}' },

      // Left alone: no value in the column at all, and cells that clean away to
      // nothing or to a bare `+`. A rule whose fix is "the digits" cannot
      // propose a phone number with none in it; the empty cell is P36's.
      { legacyPatientId: 'p-null', phone: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', phone: '', rawData: '{}' },
      { legacyPatientId: 'p-blank', phone: '   ', rawData: '{}' },
      { legacyPatientId: 'p-dashonly', phone: '-', rawData: '{}' },
      { legacyPatientId: 'p-emptybrackets', phone: '()', rawData: '{}' },
      { legacyPatientId: 'p-plusonly', phone: '+ ()', rawData: '{}' },

      // Left alone, and these are the rows that matter most: a letter or an
      // extension anywhere in the cell. Removing the grouping and proposing
      // what is left would hand on a number with characters quietly dropped out
      // of it — P34 reports the cell whole instead.
      { legacyPatientId: 'p-extension', phone: '06-12345678 ext 12', rawData: '{}' },
      { legacyPatientId: 'p-tst', phone: '06 12345678 tst', rawData: '{}' },
      { legacyPatientId: 'p-word', phone: 'onbekend', rawData: '{}' },

      // Left alone: marks the catalogue did not name. Each hints at a cell
      // holding something other than one grouped number — two numbers, a note,
      // a doubt, a typographic dash nobody typed on purpose, a brace that is
      // not a bracket anybody groups digits with.
      { legacyPatientId: 'p-slash', phone: '06/12345678', rawData: '{}' },
      { legacyPatientId: 'p-comma', phone: '06,12345678', rawData: '{}' },
      { legacyPatientId: 'p-question', phone: '0612345678?', rawData: '{}' },
      { legacyPatientId: 'p-endash', phone: `06${EN_DASH}12345678`, rawData: '{}' },
      { legacyPatientId: 'p-curly', phone: '{020}1234567', rawData: '{}' },

      // Left alone: a `+` that is not at the front, and a second one. The fix
      // is "the digits and any leading `+`", and neither of these is that.
      { legacyPatientId: 'p-innerplus', phone: '06+31612345678', rawData: '{}' },
      { legacyPatientId: 'p-doubleplus', phone: '++31612345678', rawData: '{}' },

      // Left alone: grouping spelled into other columns entirely. P30 tests one
      // column (1.1.5) — a grouped bsn is P26's, a comma decimal P41's, a
      // dotted date P17's, doubled spaces in a name P03's — and this row's
      // phone is already clean.
      {
        legacyPatientId: 'p-othercolumn',
        phone: '0612345678',
        bsn: '123 456 789',
        weight: '82,5',
        dob: '03.07.1984',
        fullName: 'Jan  Jansen',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // phone here is already clean.
      { legacyPatientId: ' p-paddedid ', phone: '0612345678', rawData: '{}' },
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

  it('proposes the digits and any leading plus for every grouped number', async () => {
    const response = await p30.run(context);

    // The value matters, not just that the rule fired: each `next` is the same
    // digits in the same order with the grouping gone and a leading `+` kept —
    // no digit added, dropped or reordered, and no length or country code
    // judged. One call, every row (1.1.14), and `column` is the column that was
    // tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-dashes',
        column: 'phone',
        prev: '06-12345678',
        next: '0612345678',
      },
      {
        table: 'patient',
        legacyId: 'p-dots',
        column: 'phone',
        prev: '06.12.34.56.78',
        next: '0612345678',
      },
      {
        table: 'patient',
        legacyId: 'p-doubleoh',
        column: 'phone',
        prev: '00 31 6 1234 5678',
        // The `00` stays a `00`: turning it into a `+` is P31's fix, and this
        // rule does not reach for it.
        next: '0031612345678',
      },
      {
        table: 'patient',
        legacyId: 'p-landline',
        column: 'phone',
        prev: '020 123 4567',
        next: '0201234567',
      },
      {
        table: 'patient',
        legacyId: 'p-mixed',
        column: 'phone',
        prev: '(06) 12-34.56 78',
        // All four marks in one cell, and the digits come out in order.
        next: '0612345678',
      },
      {
        table: 'patient',
        legacyId: 'p-nbsp',
        column: 'phone',
        prev: `06${NBSP}12345678`,
        next: '0612345678',
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'phone',
        prev: '  0612345678  ',
        // Padding at the ends goes with the grouping inside: the whole cell
        // becomes the digits it held.
        next: '0612345678',
      },
      {
        table: 'patient',
        legacyId: 'p-parens',
        column: 'phone',
        prev: '(020) 123 4567',
        // The bracketed area code is digits of the number, so it keeps them.
        next: '0201234567',
      },
      {
        table: 'patient',
        legacyId: 'p-placeholder',
        column: 'phone',
        prev: '000 000 000',
        // Nine zeroes is a placeholder, and saying so is P35's finding.
        // Cleaning the cell is still this rule's fix.
        next: '000000000',
      },
      {
        table: 'patient',
        legacyId: 'p-plusdashes',
        column: 'phone',
        prev: '+31-6-1234-5678',
        next: '+31612345678',
      },
      {
        table: 'patient',
        legacyId: 'p-plusspaces',
        column: 'phone',
        prev: '+31 6 1234 5678',
        // The leading `+` is not grouping and stays where it was.
        next: '+31612345678',
      },
      {
        table: 'patient',
        legacyId: 'p-short',
        column: 'phone',
        prev: '06 12',
        // Four digits is no phone number, and saying so is P33's finding.
        next: '0612',
      },
      {
        table: 'patient',
        legacyId: 'p-spaces',
        column: 'phone',
        prev: '06 12 34 56 78',
        next: '0612345678',
      },
      {
        table: 'patient',
        legacyId: 'p-squarebrackets',
        column: 'phone',
        prev: '[020] 1234567',
        next: '0201234567',
      },
      {
        table: 'patient',
        legacyId: 'p-tab',
        column: 'phone',
        prev: '06\t12345678',
        next: '0612345678',
      },
      {
        table: 'patient',
        legacyId: 'p-trailingdash',
        column: 'phone',
        prev: '0612345678-',
        next: '0612345678',
      },
      {
        table: 'patient',
        legacyId: 'p-trunkzero',
        column: 'phone',
        prev: '+31 (0)6 12345678',
        // The brackets come out and the zero they held stays: every digit the
        // cell carried is in the proposal. That this is now too long for any
        // number is P33's finding, not a reason for this rule to drop a digit.
        next: '+310612345678',
      },
    ]);
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p30.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `phone`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.phone).toBe(update.prev);
    }
  });

  it('leaves clean numbers, letters, other marks and every other cell alone', async () => {
    const response = await p30.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Already what this rule produces, so there is nothing to propose.
    expect(touched).not.toContain('p-clean');
    expect(touched).not.toContain('p-cleanplus');

    // No digits to propose once the grouping is gone.
    expect(touched).not.toContain('p-null');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-dashonly');
    expect(touched).not.toContain('p-emptybrackets');
    expect(touched).not.toContain('p-plusonly');

    // A letter or an extension anywhere in the cell: the rule never strips what
    // it does not name, so those survive the removal and send the row to P34
    // whole.
    expect(touched).not.toContain('p-extension');
    expect(touched).not.toContain('p-tst');
    expect(touched).not.toContain('p-word');

    // Marks the catalogue did not name.
    expect(touched).not.toContain('p-slash');
    expect(touched).not.toContain('p-comma');
    expect(touched).not.toContain('p-question');
    expect(touched).not.toContain('p-endash');
    expect(touched).not.toContain('p-curly');

    // A `+` that is not leading, and a second `+`.
    expect(touched).not.toContain('p-innerplus');
    expect(touched).not.toContain('p-doubleplus');

    // And no other column is proposed against, however it is grouped (1.1.5) —
    // including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-othercolumn');
    expect(touched).not.toContain(' p-paddedid ');
    for (const update of response.updates) {
      expect(update.column).toBe('phone');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries the digits it read', async () => {
    const response = await p30.run(context);

    // The catalogue does not mark P30 ambiguous: a grouping mark carries no
    // information, so removing it is reading the cell rather than guessing at
    // it. The flag is rule-wide (1.1.12), stated once beside the updates, and
    // the `rule` row says the same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p30.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      // Never a proposal with nothing in it: a cell already holding a bare
      // number is walked past rather than reported unchanged.
      expect(update.next).not.toBe(update.prev);

      const proposed = update.next ?? '';
      const previous = update.prev ?? '';

      // Digits, with at most one `+` and only at the front — which is the whole
      // of what "the digits and any leading `+`" means.
      expect(proposed).toMatch(/^\+?[0-9]+$/);
      expect(proposed).toBe(previous.replace(/[\s.()[\]-]/g, ''));

      // Every digit of the old value is in the new one, in the same order, and
      // no digit that was not. A `+` the cell had is still there, and a cell
      // without one is not given one.
      expect([...previous].filter((character) => /[0-9]/.test(character)).join('')).toBe(
        proposed.replace('+', ''),
      );
      expect(proposed.startsWith('+')).toBe(previous.trim().startsWith('+'));
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p30.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-dashes');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). What it proposes holds no grouping mark, so the rule is
    // self-terminating and the applied row needs no guard to keep it from being
    // re-proposed.
    await patients.update({ legacyPatientId: 'p-dashes' }, { phone: '0612345678' });

    const after = await p30.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-dashes');

    await patients.update({ legacyPatientId: 'p-dashes' }, { phone: '06-12345678' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p30.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(37);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P30 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p30);
    expect(p30.ruleId).toBe('P30');
    expect(p30.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p30.ruleName.length).toBeGreaterThan(0);
    expect(p30.description.length).toBeGreaterThan(0);
  });
});
