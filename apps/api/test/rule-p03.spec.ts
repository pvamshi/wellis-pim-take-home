import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p03 } from '../src/rules/catalogue/p03';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P03 — a patient `full_name` padded at the ends or spaced out inside, against
 * a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P03 — a patient name with stray whitespace', () => {
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
      // What the rule is for: padding on one end, the other, or both; a doubled
      // space inside; and tabs and newlines, which are whitespace too.
      { legacyPatientId: 'p-lead', fullName: '  Jan de Vries', rawData: '{}' },
      { legacyPatientId: 'p-trail', fullName: 'Jan de Vries   ', rawData: '{}' },
      { legacyPatientId: 'p-both', fullName: ' Jan de Vries ', rawData: '{}' },
      { legacyPatientId: 'p-inner', fullName: 'Jan  de   Vries', rawData: '{}' },
      { legacyPatientId: 'p-tab', fullName: '\tJan\tde Vries\n', rawData: '{}' },

      // Whitespace is all this rule fixes. The name stays comma-inverted (P05)
      // and stays shouted (P04) — those are other rules and other approvals.
      { legacyPatientId: 'p-inverted', fullName: 'Berg,  Jan van der', rawData: '{}' },

      // Left alone: already clean, however else it reads.
      { legacyPatientId: 'p-clean', fullName: 'Jan de Vries', rawData: '{}' },
      { legacyPatientId: 'p-shouting', fullName: 'JAN DE VRIES', rawData: '{}' },

      // Left alone: cleaning leaves nothing, which is the empty name P08 asks a
      // human about, and null is the same absence arriving as null.
      { legacyPatientId: 'p-blank', fullName: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', fullName: '', rawData: '{}' },
      { legacyPatientId: 'p-null', fullName: null, rawData: '{}' },

      // Left alone: whitespace on other columns entirely. P03 tests one column
      // (1.1.5) and this row's name is clean.
      {
        legacyPatientId: 'p-other-column',
        fullName: 'Piet Jansen',
        city: '  Utrecht  ',
        email: ' piet@example.com ',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's.
      { legacyPatientId: ' p-padded-id ', fullName: 'Sanne Bakker', rawData: '{}' },
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

  it('proposes the cleaned name for every name with stray whitespace', async () => {
    const response = await p03.run(context);

    // The value matters, not just that the rule fired: each `next` is the name
    // trimmed at both ends with every inner run of whitespace reduced to one
    // space, and nothing else done to it. One call, every row (1.1.14), and
    // `column` is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-both',
        column: 'full_name',
        prev: ' Jan de Vries ',
        next: 'Jan de Vries',
      },
      {
        table: 'patient',
        legacyId: 'p-inner',
        column: 'full_name',
        prev: 'Jan  de   Vries',
        next: 'Jan de Vries',
      },
      {
        table: 'patient',
        legacyId: 'p-inverted',
        column: 'full_name',
        prev: 'Berg,  Jan van der',
        // Still inverted afterwards. P03 spaced it correctly and left the rest
        // of the problem to P05 (1.1.4).
        next: 'Berg, Jan van der',
      },
      {
        table: 'patient',
        legacyId: 'p-lead',
        column: 'full_name',
        prev: '  Jan de Vries',
        next: 'Jan de Vries',
      },
      {
        table: 'patient',
        legacyId: 'p-tab',
        column: 'full_name',
        prev: '\tJan\tde Vries\n',
        next: 'Jan de Vries',
      },
      {
        table: 'patient',
        legacyId: 'p-trail',
        column: 'full_name',
        prev: 'Jan de Vries   ',
        next: 'Jan de Vries',
      },
    ]);
  });

  it('addresses each finding by the row it read the name from', async () => {
    const response = await p03.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `full_name`, so the id it reports is the row's
    // own, untouched, and the stored row still holds the name it reports as
    // `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.fullName).toBe(update.prev);
    }
  });

  it('leaves a clean name, a blank name and a missing name alone', async () => {
    const response = await p03.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A clean name has nothing to fix, whatever else is wrong with it: shouting
    // is P04's and neither is this rule's business (1.1.4). A name that is only
    // whitespace cleans to nothing, which is the empty name P08 reports, so
    // proposing it here would be a second fix in one rule.
    expect(touched).not.toContain('p-clean');
    expect(touched).not.toContain('p-shouting');
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');

    // And no other column is proposed against, however dirty it is (1.1.5) —
    // including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('full_name');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries a proposed value', async () => {
    const response = await p03.run(context);

    // The catalogue does not mark P03 ambiguous: there is one reading of a
    // padded name. The flag is rule-wide (1.1.12), stated once beside the
    // updates, and the `rule` row says the same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p03.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);
      expect(update.next?.trim()).toBe(update.next);
      expect(update.next).not.toMatch(/\s\s/);
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p03.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-inner');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). The rule is self-terminating, so the applied row needs no
    // guard to keep it from being re-proposed.
    await patients.update({ legacyPatientId: 'p-inner' }, { fullName: 'Jan de Vries' });

    const after = await p03.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-inner');

    await patients.update({ legacyPatientId: 'p-inner' }, { fullName: 'Jan  de   Vries' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p03.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(13);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P03 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p03);
    expect(p03.ruleId).toBe('P03');
    expect(p03.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p03.ruleName.length).toBeGreaterThan(0);
    expect(p03.description.length).toBeGreaterThan(0);
  });
});
