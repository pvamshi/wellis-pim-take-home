import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p42 } from '../src/rules/catalogue/p42';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P42 — a patient `weight` with the unit typed into the value, against a real
 * database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P42 — a patient weight carrying its unit in the value', () => {
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
      // The catalogue's own two examples: the unit with a space in front of it
      // and the unit written tight against the number.
      { legacyPatientId: 'w-space', weight: '82 kg', weightUnit: null, rawData: '{}' },
      { legacyPatientId: 'w-tight', weight: '180lbs', weightUnit: null, rawData: '{}' },

      // The rest of the closed list, in the cases a form produces them in: a
      // unit is a unit however it is capitalised, and however it is spelt out.
      { legacyPatientId: 'w-caps', weight: '95 KG', weightUnit: null, rawData: '{}' },
      { legacyPatientId: 'w-kgs', weight: '91 kgs', weightUnit: null, rawData: '{}' },
      { legacyPatientId: 'w-kilo', weight: '77 kilo', weightUnit: null, rawData: '{}' },
      { legacyPatientId: 'w-kilogram', weight: '88 Kilogram', weightUnit: null, rawData: '{}' },
      { legacyPatientId: 'w-lb', weight: '200 lb', weightUnit: null, rawData: '{}' },
      { legacyPatientId: 'w-pounds', weight: '154 pounds', weightUnit: null, rawData: '{}' },

      // A fraction is part of the number and is handed back with it, and an
      // abbreviation closed with a dot is the same abbreviation.
      { legacyPatientId: 'w-decimal', weight: '82.5 kg', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'w-dotted-unit', weight: '82 kg.', weightUnit: null, rawData: '{}' },

      // The padding goes with the unit: `weight` has no whitespace rule of its
      // own, and what is proposed is the number.
      { legacyPatientId: 'w-padded', weight: '  82 kg  ', weightUnit: null, rawData: '{}' },

      // Left alone: no unit in the value, which is how the column is meant to
      // read and how every row of the export in hand already reads.
      { legacyPatientId: 'w-bare', weight: '95', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'w-bare-decimal', weight: '82.5', weightUnit: 'kg', rawData: '{}' },

      // Left alone: the number is not a number yet. This cell is P41's finding,
      // and this rule takes the unit off it on the run after P41's fix — two
      // defects, two fixes, two approvals (1.1.4).
      { legacyPatientId: 'w-comma', weight: '82,5 kg', weightUnit: null, rawData: '{}' },

      // Left alone: the list is closed, so a word this rule has never seen is
      // never stripped to leave the digits standing on their own.
      { legacyPatientId: 'w-unknown-unit', weight: '82 steen', weightUnit: null, rawData: '{}' },
      { legacyPatientId: 'w-gram', weight: '820 gram', weightUnit: null, rawData: '{}' },
      { legacyPatientId: 'w-pond', weight: '82 pond', weightUnit: null, rawData: '{}' },

      // Left alone: a cell holding more than a number and a unit has more than
      // one reading, and P43 puts it in front of a human.
      { legacyPatientId: 'w-unit-first', weight: 'kg 82', weightUnit: null, rawData: '{}' },
      { legacyPatientId: 'w-extra', weight: '82 kg netto', weightUnit: null, rawData: '{}' },
      { legacyPatientId: 'w-bracket', weight: '82 kg (geschat)', weightUnit: null, rawData: '{}' },

      // Left alone: a unit with no number in front of it, and a cell that holds
      // no number at all. There is nothing here to propose as a weight.
      { legacyPatientId: 'w-no-number', weight: 'kg', weightUnit: null, rawData: '{}' },
      { legacyPatientId: 'w-prose', weight: 'onbekend', weightUnit: null, rawData: '{}' },

      // Left alone: an empty cell is P45's finding.
      { legacyPatientId: 'w-empty', weight: '', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'w-blank', weight: '   ', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'w-null', weight: null, weightUnit: 'kg', rawData: '{}' },

      // Left alone: the unit sitting in another column's value is not this
      // rule's to take out (1.1.5), and `weight_unit` is never read at all.
      {
        legacyPatientId: 'w-other-column',
        weight: '95',
        weightUnit: 'kilo',
        heightCm: '180 cm',
        city: 'Utrecht',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's.
      { legacyPatientId: ' w-padded-id ', weight: '95', weightUnit: 'kg', rawData: '{}' },
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

  it('proposes the number alone for every weight carrying its unit', async () => {
    const response = await p42.run(context);

    // The value matters, not just that the rule fired: each `next` is the
    // digits the patient reported and nothing else. One call, every row
    // (1.1.14), and `column` is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'w-caps',
        column: 'weight',
        prev: '95 KG',
        next: '95',
      },
      {
        table: 'patient',
        legacyId: 'w-decimal',
        column: 'weight',
        prev: '82.5 kg',
        // The fraction is part of the number and comes back with it.
        next: '82.5',
      },
      {
        table: 'patient',
        legacyId: 'w-dotted-unit',
        column: 'weight',
        prev: '82 kg.',
        next: '82',
      },
      {
        table: 'patient',
        legacyId: 'w-kgs',
        column: 'weight',
        prev: '91 kgs',
        next: '91',
      },
      {
        table: 'patient',
        legacyId: 'w-kilo',
        column: 'weight',
        prev: '77 kilo',
        next: '77',
      },
      {
        table: 'patient',
        legacyId: 'w-kilogram',
        column: 'weight',
        prev: '88 Kilogram',
        next: '88',
      },
      {
        table: 'patient',
        legacyId: 'w-lb',
        column: 'weight',
        prev: '200 lb',
        // The unit is off the value and is written nowhere else: what the
        // number means is `weight_unit`'s column and P46 to P48's rules.
        next: '200',
      },
      {
        table: 'patient',
        legacyId: 'w-padded',
        column: 'weight',
        prev: '  82 kg  ',
        // The padding goes with the unit, the way it goes with the separators
        // in P26 and the grouping in P30.
        next: '82',
      },
      {
        table: 'patient',
        legacyId: 'w-pounds',
        column: 'weight',
        prev: '154 pounds',
        next: '154',
      },
      {
        table: 'patient',
        legacyId: 'w-space',
        column: 'weight',
        prev: '82 kg',
        next: '82',
      },
      {
        table: 'patient',
        legacyId: 'w-tight',
        column: 'weight',
        prev: '180lbs',
        next: '180',
      },
    ]);
  });

  it('addresses each finding by the row it read the weight from', async () => {
    const response = await p42.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `weight`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.weight).toBe(update.prev);
    }
  });

  it('leaves a bare number, an unrecognised unit and an empty cell alone', async () => {
    const response = await p42.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Nothing to propose when the value is already the number alone.
    expect(touched).not.toContain('w-bare');
    expect(touched).not.toContain('w-bare-decimal');

    // A comma decimal is not a number, so taking the unit off would not leave
    // one. P41 settles the separator first.
    expect(touched).not.toContain('w-comma');

    // The list is closed: a word this rule does not know is never stripped, and
    // a real unit the export cannot express is not read as one of these two.
    expect(touched).not.toContain('w-unknown-unit');
    expect(touched).not.toContain('w-gram');
    expect(touched).not.toContain('w-pond');

    // More than a number and a unit in the cell is more than one reading.
    expect(touched).not.toContain('w-unit-first');
    expect(touched).not.toContain('w-extra');
    expect(touched).not.toContain('w-bracket');

    // A unit with no number, and a cell with no number at all: there is no
    // weight here to propose.
    expect(touched).not.toContain('w-no-number');
    expect(touched).not.toContain('w-prose');

    // An empty cell, one holding nothing but whitespace, and an absent one are
    // P45's finding.
    expect(touched).not.toContain('w-empty');
    expect(touched).not.toContain('w-blank');
    expect(touched).not.toContain('w-null');

    // And no other column is proposed against, however plainly it carries the
    // same defect (1.1.5) — including `height_cm` with its unit in the value,
    // and the padded legacy id, which is P01's.
    expect(touched).not.toContain('w-other-column');
    expect(touched).not.toContain(' w-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('weight');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding proposes the number that was in the cell', async () => {
    const response = await p42.run(context);

    // The catalogue does not mark P42 ambiguous: the number is already in the
    // cell and removing the unit takes nothing away from it. The flag is
    // rule-wide (1.1.12), stated once beside the updates, and the `rule` row
    // says the same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p42.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);

      // What is proposed is a number and nothing else — no letters, no padding.
      expect(update.next).toMatch(/^\d+(\.\d+)?$/);

      // And the digits are the digits that were in the cell: the proposal is
      // the front of the value once its padding is off, so nothing was
      // computed, converted or rounded on the patient's behalf.
      expect(update.prev?.trim().startsWith(update.next ?? '')).toBe(true);
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p42.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('w-space');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). The rule is self-terminating, so the applied row needs no
    // guard to keep it from being re-proposed — a cell has to end in a unit to
    // be read at all, and this one no longer does.
    await patients.update({ legacyPatientId: 'w-space' }, { weight: '82' });

    const after = await p42.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('w-space');

    await patients.update({ legacyPatientId: 'w-space' }, { weight: '82 kg' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p42.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(27);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P42 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p42);
    expect(p42.ruleId).toBe('P42');
    expect(p42.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p42.ruleName.length).toBeGreaterThan(0);
    expect(p42.description.length).toBeGreaterThan(0);
  });
});
