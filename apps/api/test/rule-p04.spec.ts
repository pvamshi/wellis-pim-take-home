import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p04 } from '../src/rules/catalogue/p04';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P04 — a patient `full_name` shouted in capitals or typed all in lower case,
 * against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P04 — a patient name with no case left in it', () => {
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
      // What the rule is for: a name in capitals, and the same name in lower
      // case. Both have lost the same thing.
      { legacyPatientId: 'p-shouted', fullName: 'JAN DE VRIES', rawData: '{}' },
      { legacyPatientId: 'p-lower', fullName: 'jan de vries', rawData: '{}' },

      // The particles, which is the whole of what makes this more than
      // capitalising every word.
      { legacyPatientId: 'p-den', fullName: 'RUBEN VAN DEN BERG', rawData: '{}' },
      { legacyPatientId: 'p-ten', fullName: 'sanne ten boom', rawData: '{}' },

      // A particle in first position, where Dutch capitalises it.
      { legacyPatientId: 'p-inverted', fullName: 'de vries, jan', rawData: '{}' },

      // Accented letters are letters, and a name carries capitals inside a word
      // as well as at the front of one.
      { legacyPatientId: 'p-accent', fullName: 'JOSÉ GARCÍA', rawData: '{}' },
      { legacyPatientId: 'p-hyphen', fullName: 'ANNE-MARIE DE WIT', rawData: '{}' },
      { legacyPatientId: 'p-apostrophe', fullName: "fatima o'brien", rawData: '{}' },

      // Case is all this rule fixes. The doubled space and the trailing space
      // survive the proposal — collapsing them is P03's fix and P03's approval.
      { legacyPatientId: 'p-spaced', fullName: 'JAN  DE VRIES ', rawData: '{}' },

      // Not a name at all, but it is a name in capitals, so the case is
      // restored and nothing else is said about it. That the cell holds an
      // address rather than a person is P07's finding (1.1.4).
      { legacyPatientId: 'p-email', fullName: 'JAN.DE.VRIES@EXAMPLE.COM', rawData: '{}' },

      // Left alone: the name already carries both cases, so nothing was lost —
      // including the half-shouted one, which the catalogue's "entirely in
      // capitals or entirely in lower case" does not describe.
      { legacyPatientId: 'p-mixed', fullName: 'Jan de Vries', rawData: '{}' },
      { legacyPatientId: 'p-half', fullName: 'JAN de Vries', rawData: '{}' },

      // Left alone: title case gives this one straight back.
      { legacyPatientId: 'p-initial', fullName: 'J', rawData: '{}' },

      // Left alone: no cased letters to restore. What a number is doing in the
      // name column is P07's question, and an absent name is P08's.
      { legacyPatientId: 'p-digits', fullName: '12345', rawData: '{}' },
      { legacyPatientId: 'p-blank', fullName: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', fullName: '', rawData: '{}' },
      { legacyPatientId: 'p-null', fullName: null, rawData: '{}' },

      // Left alone: shouting on other columns entirely. P04 tests one column
      // (1.1.5) and this row's name is fine.
      {
        legacyPatientId: 'p-other-column',
        fullName: 'Piet Jansen',
        city: 'UTRECHT',
        email: 'PIET@EXAMPLE.COM',
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

  it('proposes the title-cased name for every name written in one case', async () => {
    const response = await p04.run(context);

    // The value matters, not just that the rule fired: each `next` is the name
    // in title case with the Dutch particles left down, and the spacing of the
    // original untouched. One call, every row (1.1.14), and `column` is the
    // column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-accent',
        column: 'full_name',
        prev: 'JOSÉ GARCÍA',
        next: 'José García',
      },
      {
        table: 'patient',
        legacyId: 'p-apostrophe',
        column: 'full_name',
        prev: "fatima o'brien",
        next: "Fatima O'Brien",
      },
      {
        table: 'patient',
        legacyId: 'p-den',
        column: 'full_name',
        prev: 'RUBEN VAN DEN BERG',
        // Both particles stay down. `Van Den Berg` would be the wrong name
        // printed on every screen that shows this patient.
        next: 'Ruben van den Berg',
      },
      {
        table: 'patient',
        legacyId: 'p-email',
        column: 'full_name',
        prev: 'JAN.DE.VRIES@EXAMPLE.COM',
        // Still an address afterwards. P04 restored the case and left the rest
        // of the problem to P07 (1.1.4).
        next: 'Jan.de.vries@example.com',
      },
      {
        table: 'patient',
        legacyId: 'p-hyphen',
        column: 'full_name',
        prev: 'ANNE-MARIE DE WIT',
        next: 'Anne-Marie de Wit',
      },
      {
        table: 'patient',
        legacyId: 'p-inverted',
        column: 'full_name',
        prev: 'de vries, jan',
        // Capitalised here, because no given name precedes it. Still inverted
        // afterwards — that is P05's fix and P05's approval.
        next: 'De Vries, Jan',
      },
      {
        table: 'patient',
        legacyId: 'p-lower',
        column: 'full_name',
        prev: 'jan de vries',
        next: 'Jan de Vries',
      },
      {
        table: 'patient',
        legacyId: 'p-shouted',
        column: 'full_name',
        prev: 'JAN DE VRIES',
        next: 'Jan de Vries',
      },
      {
        table: 'patient',
        legacyId: 'p-spaced',
        column: 'full_name',
        prev: 'JAN  DE VRIES ',
        // The doubled space and the trailing space are still there: this rule
        // changes case and only case (1.1.4).
        next: 'Jan  de Vries ',
      },
      {
        table: 'patient',
        legacyId: 'p-ten',
        column: 'full_name',
        prev: 'sanne ten boom',
        next: 'Sanne ten Boom',
      },
    ]);
  });

  it('addresses each finding by the row it read the name from', async () => {
    const response = await p04.run(context);

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

  it('leaves a name that already carries case, and one with no letters, alone', async () => {
    const response = await p04.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A name with both cases in it lost nothing, whatever else is wrong with
    // it, and the half-shouted one is not "entirely" either case. A name that
    // title-cases to itself has nothing to propose, and a value with no cased
    // letters has nothing to case at all.
    expect(touched).not.toContain('p-mixed');
    expect(touched).not.toContain('p-half');
    expect(touched).not.toContain('p-initial');
    expect(touched).not.toContain('p-digits');
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');

    // And no other column is proposed against, however loudly it shouts
    // (1.1.5) — including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('full_name');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries a proposed value', async () => {
    const response = await p04.run(context);

    // The catalogue does not mark P04 ambiguous: a name with no case left has
    // one sensible reading. The flag is rule-wide (1.1.12), stated once beside
    // the updates, and the `rule` row says the same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p04.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);

      // Every proposal carries both cases now, which is exactly why the rule
      // does not match it a second time.
      expect(update.next).not.toBe(update.next?.toUpperCase());
      expect(update.next).not.toBe(update.next?.toLowerCase());

      // And the spacing came through untouched, because P03 owns spacing: the
      // whitespace of the proposal, character for character and position for
      // position, is the whitespace of the original.
      expect(update.next?.replace(/\S/g, '.')).toBe(update.prev?.replace(/\S/g, '.'));
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p04.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-shouted');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). The rule is self-terminating, so the applied row needs no
    // guard to keep it from being re-proposed.
    await patients.update({ legacyPatientId: 'p-shouted' }, { fullName: 'Jan de Vries' });

    const after = await p04.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-shouted');

    await patients.update({ legacyPatientId: 'p-shouted' }, { fullName: 'JAN DE VRIES' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p04.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(19);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P04 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p04);
    expect(p04.ruleId).toBe('P04');
    expect(p04.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p04.ruleName.length).toBeGreaterThan(0);
    expect(p04.description.length).toBeGreaterThan(0);
  });
});
