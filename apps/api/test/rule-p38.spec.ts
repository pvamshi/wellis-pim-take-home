import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p38 } from '../src/rules/catalogue/p38';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P38 — a patient `city` holding a known alias rather than the town's own name,
 * against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P38 — a patient city written as a known alias for the town', () => {
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
      // The three aliases the catalogue names, typed as the catalogue writes
      // them.
      { legacyPatientId: 'p-adam', city: "A'dam", rawData: '{}' },
      { legacyPatientId: 'p-bosch', city: 'Den Bosch', rawData: '{}' },
      { legacyPatientId: 'p-gravenhage', city: 's Gravenhage', rawData: '{}' },

      // The same Hague alias as four people type it: elision written or
      // dropped, parts joined by a hyphen or a space.
      { legacyPatientId: 'p-gravenhage-elision', city: "'s Gravenhage", rawData: '{}' },
      { legacyPatientId: 'p-gravenhage-hyphen', city: 's-Gravenhage', rawData: '{}' },
      { legacyPatientId: 'p-gravenhage-both', city: "'s-Gravenhage", rawData: '{}' },

      // Typed however the person typed it: shouted, lower-cased, padded, spaced
      // out inside, and with the apostrophe a word processor substituted. Each
      // is caught here without waiting on P37 to tidy it first.
      { legacyPatientId: 'p-shouted', city: 'DEN BOSCH', rawData: '{}' },
      { legacyPatientId: 'p-lower', city: "a'dam", rawData: '{}' },
      { legacyPatientId: 'p-padded', city: "  A'dam  ", rawData: '{}' },
      { legacyPatientId: 'p-doubled', city: 'Den  Bosch', rawData: '{}' },
      { legacyPatientId: 'p-tab', city: 'Den\tBosch', rawData: '{}' },
      { legacyPatientId: 'p-curly', city: 'A’dam', rawData: '{}' },

      // Left alone: the town already written as itself, including the two names
      // this rule proposes.
      { legacyPatientId: 'p-amsterdam', city: 'Amsterdam', rawData: '{}' },
      { legacyPatientId: 'p-den-haag', city: 'Den Haag', rawData: '{}' },
      { legacyPatientId: 'p-hertogenbosch', city: "'s-Hertogenbosch", rawData: '{}' },

      // Left alone: a town this rule has never heard of, and the parallel
      // abbreviation that is deliberately not on the list.
      { legacyPatientId: 'p-unknown', city: 'Zwolle', rawData: '{}' },
      { legacyPatientId: 'p-rdam', city: "R'dam", rawData: '{}' },

      // Left alone: a first name is not a city, and rewriting it would turn a
      // misfiled person into Amsterdam and be certain about it.
      { legacyPatientId: 'p-first-name', city: 'Adam', rawData: '{}' },

      // Left alone: part of a cell is never read. An address that contains an
      // alias is P39's finding, reported whole.
      { legacyPatientId: 'p-address', city: "Kerkstraat 12, A'dam", rawData: '{}' },

      // Left alone: no alias in an empty cell. P40's finding.
      { legacyPatientId: 'p-blank', city: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', city: '', rawData: '{}' },
      { legacyPatientId: 'p-null', city: null, rawData: '{}' },

      // Left alone: the alias is in another column entirely. P38 tests one
      // column (1.1.5) and this row's city is fine.
      {
        legacyPatientId: 'p-other-column',
        fullName: "A'dam",
        email: 'den.bosch@example.com',
        city: 'Utrecht',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's.
      { legacyPatientId: ' p-padded-id ', city: 'Breda', rawData: '{}' },
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

  it('proposes the town each known alias names', async () => {
    const response = await p38.run(context);

    // The value matters, not just that the rule fired: each `next` is the town
    // the alias names, written the way the place is written, replacing the whole
    // cell. One call, every row (1.1.14), and `column` is the column that was
    // tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-adam',
        column: 'city',
        prev: "A'dam",
        next: 'Amsterdam',
      },
      {
        table: 'patient',
        legacyId: 'p-bosch',
        column: 'city',
        prev: 'Den Bosch',
        // The nickname resolves to the name the town is written under, since
        // this column holds neither spelling of its own.
        next: "'s-Hertogenbosch",
      },
      {
        table: 'patient',
        legacyId: 'p-curly',
        column: 'city',
        prev: 'A’dam',
        // A substituted apostrophe is the same alias typed through a word
        // processor.
        next: 'Amsterdam',
      },
      {
        table: 'patient',
        legacyId: 'p-doubled',
        column: 'city',
        prev: 'Den  Bosch',
        next: "'s-Hertogenbosch",
      },
      {
        table: 'patient',
        legacyId: 'p-gravenhage',
        column: 'city',
        prev: 's Gravenhage',
        // The formal name resolves to the one this column already uses 123
        // times, not the other way round.
        next: 'Den Haag',
      },
      {
        table: 'patient',
        legacyId: 'p-gravenhage-both',
        column: 'city',
        prev: "'s-Gravenhage",
        next: 'Den Haag',
      },
      {
        table: 'patient',
        legacyId: 'p-gravenhage-elision',
        column: 'city',
        prev: "'s Gravenhage",
        next: 'Den Haag',
      },
      {
        table: 'patient',
        legacyId: 'p-gravenhage-hyphen',
        column: 'city',
        prev: 's-Gravenhage',
        next: 'Den Haag',
      },
      {
        table: 'patient',
        legacyId: 'p-lower',
        column: 'city',
        prev: "a'dam",
        next: 'Amsterdam',
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'city',
        prev: "  A'dam  ",
        // The whole cell is replaced, so the padding goes with the alias it
        // belonged to and the proposal needs no second tidying pass.
        next: 'Amsterdam',
      },
      {
        table: 'patient',
        legacyId: 'p-shouted',
        column: 'city',
        prev: 'DEN BOSCH',
        // Caught without waiting for P37 to put the casing back first.
        next: "'s-Hertogenbosch",
      },
      {
        table: 'patient',
        legacyId: 'p-tab',
        column: 'city',
        prev: 'Den\tBosch',
        next: "'s-Hertogenbosch",
      },
    ]);
  });

  it('addresses each finding by the row it read the city from', async () => {
    const response = await p38.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `city`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.city).toBe(update.prev);
    }
  });

  it('leaves every city that is not a known alias alone', async () => {
    const response = await p38.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // The towns this rule produces are not aliases, so there is nothing to
    // propose against them.
    expect(touched).not.toContain('p-amsterdam');
    expect(touched).not.toContain('p-den-haag');
    expect(touched).not.toContain('p-hertogenbosch');

    // Not on the fixed list, not touched — including the parallel abbreviation
    // this version deliberately leaves off, and the first name that would be
    // the most damaging entry the list could hold.
    expect(touched).not.toContain('p-unknown');
    expect(touched).not.toContain('p-rdam');
    expect(touched).not.toContain('p-first-name');

    // The whole cell is matched, never part of one, so an address that happens
    // to contain an alias stays an address and stays P39's finding.
    expect(touched).not.toContain('p-address');

    // An empty cell, and one of nothing but spaces, are P40's finding.
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');

    // And no other column is proposed against, whatever it holds (1.1.5) —
    // including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('city');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries a proposed value', async () => {
    const response = await p38.run(context);

    // The catalogue does not mark P38 ambiguous: an alias on the fixed list
    // names one town and cannot name another, so reading it is a lookup. The
    // flag is rule-wide (1.1.12), stated once beside the updates, and the `rule`
    // row says the same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p38.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    // Every proposal is one of the three towns on the list and nothing else: the
    // rule never invents a name, and never hands back a tidied version of what
    // the cell already held.
    const towns = new Set(['Amsterdam', 'Den Haag', "'s-Hertogenbosch"]);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);
      expect(towns.has(update.next ?? '')).toBe(true);
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p38.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-shouted');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). No town this rule proposes is an alias on its list, so the
    // applied row needs no guard to keep it from being re-proposed.
    await patients.update({ legacyPatientId: 'p-shouted' }, { city: "'s-Hertogenbosch" });

    const after = await p38.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-shouted');

    await patients.update({ legacyPatientId: 'p-shouted' }, { city: 'DEN BOSCH' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p38.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(24);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P38 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p38);
    expect(p38.ruleId).toBe('P38');
    expect(p38.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p38.ruleName.length).toBeGreaterThan(0);
    expect(p38.description.length).toBeGreaterThan(0);
  });
});
