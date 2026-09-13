import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p39 } from '../src/rules/catalogue/p39';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P39 — a patient `city` holding a postcode or a whole address rather than the
 * name of a town, against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P39 — a patient city holding a postcode or a whole address', () => {
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
      // A postcode and nothing else, as the three people who copy one across
      // write it.
      { legacyPatientId: 'p-postcode', city: '1012 AB', rawData: '{}' },
      { legacyPatientId: 'p-postcode-tight', city: '1012AB', rawData: '{}' },
      { legacyPatientId: 'p-postcode-digits', city: '1012', rawData: '{}' },
      { legacyPatientId: 'p-postcode-lower', city: '1012 ab', rawData: '{}' },

      // A whole address, at the lengths people paste one in at.
      { legacyPatientId: 'p-street', city: 'Kerkstraat 12', rawData: '{}' },
      { legacyPatientId: 'p-street-city', city: 'Kerkstraat 12, Amsterdam', rawData: '{}' },
      {
        legacyPatientId: 'p-street-full',
        city: 'Kerkstraat 12, 1012 AB Amsterdam',
        rawData: '{}',
      },
      { legacyPatientId: 'p-postbus', city: 'Postbus 123, Zwolle', rawData: '{}' },

      // A postcode line whose town is spelled in a way another rule would also
      // have something to say about. Caught here as it stands, without waiting
      // on P37's tidying or P38's lookup — neither of which moves a digit.
      { legacyPatientId: 'p-padded', city: '  Kerkstraat 12  ', rawData: '{}' },
      { legacyPatientId: 'p-shouted', city: 'KERKSTRAAT 12, AMSTERDAM', rawData: '{}' },
      { legacyPatientId: 'p-alias-address', city: "Kerkstraat 12, A'dam", rawData: '{}' },

      // A number written in another script is no more a town name than 1012 is.
      { legacyPatientId: 'p-arabic-indic', city: '١٠١٢ AB', rawData: '{}' },

      // Left alone: a town written in letters, however badly. Casing is P37's,
      // an alias is P38's, and a correct city is nobody's.
      { legacyPatientId: 'p-city', city: 'Amsterdam', rawData: '{}' },
      { legacyPatientId: 'p-city-shouted', city: 'AMSTERDAM', rawData: '{}' },
      { legacyPatientId: 'p-city-alias', city: "A'dam", rawData: '{}' },
      { legacyPatientId: 'p-city-elision', city: "'s-Hertogenbosch", rawData: '{}' },
      { legacyPatientId: 'p-city-connectives', city: 'Bergen op Zoom', rawData: '{}' },

      // Left alone: an address with no number in it. Nothing in the cell tells
      // a bare street name from a town this rule has never heard of, and
      // guessing would need a list of every place in the country.
      { legacyPatientId: 'p-street-only', city: 'Kerkstraat', rawData: '{}' },

      // Left alone: no number in an empty cell. P40's finding.
      { legacyPatientId: 'p-blank', city: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', city: '', rawData: '{}' },
      { legacyPatientId: 'p-null', city: null, rawData: '{}' },

      // Left alone: the postcode is in another column entirely. P39 tests one
      // column (1.1.5) and this row's city is fine.
      {
        legacyPatientId: 'p-other-column',
        fullName: '1012 AB Amsterdam',
        phone: '0612345678',
        city: 'Utrecht',
        rawData: '{}',
      },

      // Left alone: digits in the legacy id are P01's and P02's business, never
      // this rule's — the id is only the address of the row.
      { legacyPatientId: 'p-1234', city: 'Breda', rawData: '{}' },
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

  it('reports every city that holds a postcode or a whole address', async () => {
    const response = await p39.run(context);

    // One call, every row (1.1.14). `prev` is the cell exactly as stored, `next`
    // is null throughout because the rule proposes nothing (1.1.12), and
    // `column` is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-alias-address',
        column: 'city',
        // An address that happens to contain an alias is not an alias: P38
        // matches the whole cell only, so this arrives here whole.
        prev: "Kerkstraat 12, A'dam",
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-arabic-indic',
        column: 'city',
        prev: '١٠١٢ AB',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'city',
        // Reported with its padding on, not tidied on the way out.
        prev: '  Kerkstraat 12  ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-postbus',
        column: 'city',
        prev: 'Postbus 123, Zwolle',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-postcode',
        column: 'city',
        prev: '1012 AB',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-postcode-digits',
        column: 'city',
        prev: '1012',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-postcode-lower',
        column: 'city',
        prev: '1012 ab',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-postcode-tight',
        column: 'city',
        prev: '1012AB',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-shouted',
        column: 'city',
        // Caught without waiting for P37 to put the casing back first.
        prev: 'KERKSTRAAT 12, AMSTERDAM',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-street',
        column: 'city',
        prev: 'Kerkstraat 12',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-street-city',
        column: 'city',
        prev: 'Kerkstraat 12, Amsterdam',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-street-full',
        column: 'city',
        prev: 'Kerkstraat 12, 1012 AB Amsterdam',
        next: null,
      },
    ]);
  });

  it('addresses each finding by the row it read the city from', async () => {
    const response = await p39.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `city`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.city).toBe(update.prev);
    }
  });

  it('leaves every city written in letters alone', async () => {
    const response = await p39.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A town name has no number in it, however it is spelled. Casing is P37's
    // fix and an alias is P38's; neither is a postcode and neither is reported
    // here.
    expect(touched).not.toContain('p-city');
    expect(touched).not.toContain('p-city-shouted');
    expect(touched).not.toContain('p-city-alias');
    expect(touched).not.toContain('p-city-elision');
    expect(touched).not.toContain('p-city-connectives');

    // A street name with no number is not told apart from an unfamiliar town by
    // anything in the cell, so it is left where it is.
    expect(touched).not.toContain('p-street-only');

    // An empty cell, and one of nothing but spaces, are P40's finding.
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');

    // And no other column is read or reported against, whatever it holds
    // (1.1.5) — including a legacy id with digits in it, which is P01's and
    // P02's column and never this rule's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain('p-1234');
    for (const update of response.updates) {
      expect(update.column).toBe('city');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value on any finding', async () => {
    const response = await p39.run(context);

    // The catalogue marks P39 ambiguous: a postcode names a town only through a
    // table this export does not carry, and an address line has no part that is
    // reliably the town. The flag is rule-wide (1.1.12), stated once beside the
    // updates, and the `rule` row says the same thing the response does.
    expect(response.ambiguity).toBe(true);
    expect(p39.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('stops matching once a human writes the town in', async () => {
    const before = await p39.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-street-full');

    // What resolving the finding looks like: a person reads the address and
    // writes the town into the column the rule tested (1.1.5).
    await patients.update({ legacyPatientId: 'p-street-full' }, { city: 'Amsterdam' });

    const after = await p39.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-street-full');

    await patients.update(
      { legacyPatientId: 'p-street-full' },
      { city: 'Kerkstraat 12, 1012 AB Amsterdam' },
    );
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p39.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(23);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P39 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p39);
    expect(p39.ruleId).toBe('P39');
    expect(p39.version).toBe(1);

    // The description is the whole of what a human reads for an ambiguous rule
    // (1.1.12, 1.2.3), since there is no proposed value to show beside it.
    expect(p39.ruleName.length).toBeGreaterThan(0);
    expect(p39.description.length).toBeGreaterThan(0);
  });
});
