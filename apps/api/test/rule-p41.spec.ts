import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p41 } from '../src/rules/catalogue/p41';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P41 — a patient `weight` whose decimal point was typed as a comma, against a
 * real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P41 — a patient weight written with a comma for the decimal point', () => {
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
      // The catalogue's own example, and the two other shapes a self-reported
      // weight arrives in: two decimal places, and a fraction of zero that a
      // strict reader still cannot parse.
      { legacyPatientId: 'p-half', weight: '82,5', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'p-two-decimals', weight: '94,15', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'p-zero-fraction', weight: '107,0', weightUnit: 'kg', rawData: '{}' },

      // Fixed and handed on: 1.5 is under P44's floor afterwards, because how a
      // number is written says nothing about whether the number is right.
      { legacyPatientId: 'p-implausible', weight: '1,5', weightUnit: 'kg', rawData: '{}' },

      // Fixed and handed on: the unit written into the value is P42's finding,
      // and it survives this rule's fix untouched, spacing and all (1.1.4).
      { legacyPatientId: 'p-unit', weight: '82,5 kg', weightUnit: null, rawData: '{}' },
      { legacyPatientId: 'p-unit-tight', weight: '180,5lbs', weightUnit: null, rawData: '{}' },

      // Only the comma moves: the padding is not this rule's fix, so it is
      // handed back exactly as it stands.
      { legacyPatientId: 'p-padded', weight: ' 82,5 ', weightUnit: 'kg', rawData: '{}' },

      // Left alone: already written the way the column is written.
      { legacyPatientId: 'p-dot', weight: '82.5', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'p-integer', weight: '95', weightUnit: 'kg', rawData: '{}' },

      // Left alone: three digits after the comma is the shape of a thousands
      // group as much as a fraction, and this rule proposes only where there is
      // one reading. P43 and P44 read these.
      { legacyPatientId: 'p-grouped', weight: '1,234', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'p-thousand-fraction', weight: '82,500', weightUnit: 'kg', rawData: '{}' },

      // Left alone: the dot is already the decimal point, so the comma is a
      // thousands separator and swapping it would produce `1.234.5`.
      { legacyPatientId: 'p-grouped-dot', weight: '1,234.5', weightUnit: 'kg', rawData: '{}' },

      // Left alone: a second comma is a grouped number or no number at all.
      { legacyPatientId: 'p-two-commas', weight: '1,234,5', weightUnit: 'kg', rawData: '{}' },

      // Left alone: a decimal comma is written tight between its digits.
      { legacyPatientId: 'p-no-digit-before', weight: ',5', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'p-spaced-comma', weight: '82, 5', weightUnit: 'kg', rawData: '{}' },
      {
        legacyPatientId: 'p-prose',
        weight: 'onbekend, zie dossier',
        weightUnit: null,
        rawData: '{}',
      },

      // Left alone: an empty cell is P45's finding, and there is no number here
      // to repunctuate.
      { legacyPatientId: 'p-empty', weight: '', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'p-blank', weight: '   ', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'p-null', weight: null, weightUnit: 'kg', rawData: '{}' },

      // Left alone: the comma decimal is on `height_cm`, which is P49's rule and
      // P49's column. This rule reports against the column it read (1.1.5), and
      // never reads `weight_unit` to decide anything.
      {
        legacyPatientId: 'p-other-column',
        weight: '95',
        weightUnit: 'kilo',
        heightCm: '1,75',
        city: 'Utrecht',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's.
      { legacyPatientId: ' p-padded-id ', weight: '95', weightUnit: 'kg', rawData: '{}' },
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

  it('proposes the same number with a dot for every weight written with a comma', async () => {
    const response = await p41.run(context);

    // The value matters, not just that the rule fired: each `next` is the digits
    // the patient reported with a dot where the comma was, and nothing else in
    // the cell moved. One call, every row (1.1.14), and `column` is the column
    // that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-half',
        column: 'weight',
        prev: '82,5',
        next: '82.5',
      },
      {
        table: 'patient',
        legacyId: 'p-implausible',
        column: 'weight',
        prev: '1,5',
        // Still a weight nobody has afterwards, and still P44's finding. This
        // rule settles how the number is written, not whether it is right.
        next: '1.5',
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'weight',
        prev: ' 82,5 ',
        // The padding is handed back as it stands: one rule, one fix (1.1.4).
        next: ' 82.5 ',
      },
      {
        table: 'patient',
        legacyId: 'p-two-decimals',
        column: 'weight',
        prev: '94,15',
        next: '94.15',
      },
      {
        table: 'patient',
        legacyId: 'p-unit',
        column: 'weight',
        prev: '82,5 kg',
        // The unit reaches P42 exactly as it was typed.
        next: '82.5 kg',
      },
      {
        table: 'patient',
        legacyId: 'p-unit-tight',
        column: 'weight',
        prev: '180,5lbs',
        next: '180.5lbs',
      },
      {
        table: 'patient',
        legacyId: 'p-zero-fraction',
        column: 'weight',
        prev: '107,0',
        next: '107.0',
      },
    ]);
  });

  it('addresses each finding by the row it read the weight from', async () => {
    const response = await p41.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `weight`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.weight).toBe(update.prev);
    }
  });

  it('leaves a dotted weight, a grouped number and an empty cell alone', async () => {
    const response = await p41.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Nothing to propose when the decimal point is already a dot, or when there
    // is no decimal point at all.
    expect(touched).not.toContain('p-dot');
    expect(touched).not.toContain('p-integer');

    // Two readings, so no proposal: a thousands group, a comma in front of a
    // dot that is already the decimal point, and a second comma.
    expect(touched).not.toContain('p-grouped');
    expect(touched).not.toContain('p-thousand-fraction');
    expect(touched).not.toContain('p-grouped-dot');
    expect(touched).not.toContain('p-two-commas');

    // A comma that is not written tight between digits is not a decimal comma.
    expect(touched).not.toContain('p-no-digit-before');
    expect(touched).not.toContain('p-spaced-comma');
    expect(touched).not.toContain('p-prose');

    // An empty cell, and one holding nothing but whitespace, are P45's finding.
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-null');

    // And no other column is proposed against, however plainly it carries the
    // same defect (1.1.5) — including `height_cm`, which is P49's, and the
    // padded legacy id, which is P01's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('weight');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries a proposed value', async () => {
    const response = await p41.run(context);

    // The catalogue does not mark P41 ambiguous: a comma tight between digits
    // with one or two digits after it is a decimal point and nothing else. The
    // flag is rule-wide (1.1.12), stated once beside the updates, and the
    // `rule` row says the same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p41.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);

      // The proposal is a number the column can be read as: the comma is gone
      // and a dot stands where it was.
      expect(update.next).not.toContain(',');
      expect(update.next).toContain('.');

      // And the digits are untouched. Putting the comma back gives the cell
      // exactly as it was found, which is what "only the separator changed"
      // means — the unit and the padding included.
      expect(update.next?.replace('.', ',')).toBe(update.prev);
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p41.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-half');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). The rule is self-terminating, so the applied row needs no
    // guard to keep it from being re-proposed — a dot in the cell is the first
    // thing it walks past.
    await patients.update({ legacyPatientId: 'p-half' }, { weight: '82.5' });

    const after = await p41.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-half');

    await patients.update({ legacyPatientId: 'p-half' }, { weight: '82,5' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p41.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(21);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P41 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p41);
    expect(p41.ruleId).toBe('P41');
    expect(p41.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p41.ruleName.length).toBeGreaterThan(0);
    expect(p41.description.length).toBeGreaterThan(0);
  });
});
