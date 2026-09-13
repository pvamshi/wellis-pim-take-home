import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p19 } from '../src/rules/catalogue/p19';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P19 — a patient `dob` whose year is written with two digits, so the century
 * is missing from the cell, against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 35;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P19 — a patient date of birth with a two-digit year', () => {
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
      // What the rule is for: the year is two digits, so the century is not in
      // the cell. The missing digits are in the year, not in the punctuation,
      // so all three separators are one finding.
      { legacyPatientId: 'p-slash-short', dob: '03/04/54', rawData: '{}' },
      { legacyPatientId: 'p-dash-short', dob: '03-04-54', rawData: '{}' },
      { legacyPatientId: 'p-dot-short', dob: '03.04.54', rawData: '{}' },

      // The order of the day and the month is certain in both of these — there
      // is no month 14 and no month 16 — and the century is still missing, so
      // they are this rule's finding too. P16 and P17 both require four digits.
      { legacyPatientId: 'p-certain-euro-short', dob: '14-08-82', rawData: '{}' },
      { legacyPatientId: 'p-certain-us-short', dob: '02/16/62', rawData: '{}' },

      // Not zero-padded, and padded around the outside. Neither puts the
      // century back, so neither changes the finding.
      { legacyPatientId: 'p-unpadded', dob: '3-4-54', rawData: '{}' },
      { legacyPatientId: 'p-padded', dob: '  05/06/77  ', rawData: '{}' },

      // The ends of the two-digit range, and a day at the end of a month.
      { legacyPatientId: 'p-year-zero', dob: '01-01-00', rawData: '{}' },
      { legacyPatientId: 'p-year-99', dob: '23/08/99', rawData: '{}' },
      { legacyPatientId: 'p-day-31', dob: '31-12-68', rawData: '{}' },

      // The 29th of February, where the unknown century still leaves a real
      // day: 1996 and 2096 are both leap years, and 2000 is one even though
      // 1900 is not.
      { legacyPatientId: 'p-leap-possible', dob: '29-02-96', rawData: '{}' },
      { legacyPatientId: 'p-leap-2000', dob: '29-02-00', rawData: '{}' },

      // One century would put this birth in the future and the other would not.
      // Still reported, and still with no value proposed: striking a century
      // out is proposing the other one, and this rule proposes nothing.
      { legacyPatientId: 'p-future-reading', dob: '11/09/30', rawData: '{}' },

      // Left alone: a four-digit year, which is P16's, P17's and P18's business
      // between them — US-style with a certain order, European with a certain
      // order, and a date that reads both ways round.
      { legacyPatientId: 'p-four-digit-us', dob: '02/16/1962', rawData: '{}' },
      { legacyPatientId: 'p-four-digit-euro', dob: '14-08-1982', rawData: '{}' },
      { legacyPatientId: 'p-four-digit-both', dob: '03-04-1989', rawData: '{}' },

      // Left alone: a cell that changes separator half way through is none of
      // the spellings the catalogue names, here or in P16, P17 and P18.
      { legacyPatientId: 'p-mixed-separator', dob: '03-04.54', rawData: '{}' },

      // Left alone: no reading of these is a date at all, so there is nothing
      // to report that would not be invented. A number that is no month on
      // either side, a zero where a day or a month would go, a day that month
      // never had, and the 29th of a February that had 28 days in both
      // centuries.
      { legacyPatientId: 'p-no-month', dob: '20-13-54', rawData: '{}' },
      { legacyPatientId: 'p-zero-day', dob: '00-12-54', rawData: '{}' },
      { legacyPatientId: 'p-zero-month', dob: '03-00-54', rawData: '{}' },
      { legacyPatientId: 'p-impossible-day', dob: '31-04-54', rawData: '{}' },
      { legacyPatientId: 'p-no-leap', dob: '29-02-54', rawData: '{}' },

      // Left alone: 89 is neither a day nor a month, so this is not a day and a
      // month followed by a short year. A leading two-digit year is a spelling
      // no catalogue entry names.
      { legacyPatientId: 'p-leading-year', dob: '89-04-03', rawData: '{}' },

      // Left alone: a three-digit year is no year anybody wrote.
      { legacyPatientId: 'p-three-digit-year', dob: '03-04-954', rawData: '{}' },

      // Left alone: already ISO, which is what resolving this finding produces.
      { legacyPatientId: 'p-iso', dob: '2000-01-22', rawData: '{}' },
      { legacyPatientId: 'p-iso-slash', dob: '2000/01/22', rawData: '{}' },

      // Left alone: not a date at all, a date with something extra stuck to it,
      // and a separator no catalogue entry names.
      { legacyPatientId: 'p-words', dob: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-with-time', dob: '03-04-54 00:00', rawData: '{}' },
      { legacyPatientId: 'p-four-parts', dob: '03-04-19-54', rawData: '{}' },
      { legacyPatientId: 'p-space-separated', dob: '03 04 54', rawData: '{}' },

      // Left alone: no date in the column at all, which is P22's finding.
      { legacyPatientId: 'p-blank', dob: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', dob: '', rawData: '{}' },
      { legacyPatientId: 'p-null', dob: null, rawData: '{}' },

      // Left alone: a short-year date written into another column entirely. P19
      // tests one column (1.1.5) and this row's dob is already ISO.
      {
        legacyPatientId: 'p-other-column',
        dob: '1984-07-03',
        signupDate: '03-04-54',
        fullName: '03/04/54',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // dob here is already ISO.
      { legacyPatientId: ' p-padded-id ', dob: '1975-06-09', rawData: '{}' },
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

  it('reports every dob whose year is two digits, and proposes nothing', async () => {
    const response = await p19.run(context);

    // One call, every row (1.1.14). `prev` is the cell exactly as stored —
    // padding, separator and all — because the cell as written is what the
    // human has to read alongside the real date of birth they check. `next` is
    // null on all of them, which is what an ambiguous rule returns (1.1.12).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-certain-euro-short',
        column: 'dob',
        prev: '14-08-82',
        // The order is certain and the century is not, which is why this row
        // belongs here and not to P17.
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-certain-us-short',
        column: 'dob',
        prev: '02/16/62',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-dash-short',
        column: 'dob',
        prev: '03-04-54',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-day-31',
        column: 'dob',
        prev: '31-12-68',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-dot-short',
        column: 'dob',
        prev: '03.04.54',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-future-reading',
        column: 'dob',
        prev: '11/09/30',
        // 2030 has not happened and 1930 has. That is not this rule's licence
        // to propose 1930: a date in the future is P20's finding about the same
        // column, and choosing a century is the one thing this rule does not do.
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-leap-2000',
        column: 'dob',
        prev: '29-02-00',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-leap-possible',
        column: 'dob',
        prev: '29-02-96',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'dob',
        prev: '  05/06/77  ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-slash-short',
        column: 'dob',
        prev: '03/04/54',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-unpadded',
        column: 'dob',
        prev: '3-4-54',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-year-99',
        column: 'dob',
        prev: '23/08/99',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-year-zero',
        column: 'dob',
        prev: '01-01-00',
        next: null,
      },
    ]);
  });

  it('addresses each finding by the row it read the date from', async () => {
    const response = await p19.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `dob`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the date it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.dob).toBe(update.prev);
    }
  });

  it('reports the missing century whichever of the three separators the cell used', async () => {
    const response = await p19.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // The same short year, spelled three ways, is one finding: the century is
    // missing from the year and not from the punctuation (1.1.4).
    expect(touched).toContain('p-slash-short');
    expect(touched).toContain('p-dash-short');
    expect(touched).toContain('p-dot-short');
  });

  it('reports it whether or not the order of the day and month is certain', async () => {
    const response = await p19.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // P16, P17 and P18 all require a four-digit year, so a two-digit year
    // reaches this rule and no other. It is the only entry speaking for these
    // cells, which is why it takes both orders rather than only the two-way
    // ones.
    expect(touched).toContain('p-certain-euro-short');
    expect(touched).toContain('p-certain-us-short');
    expect(touched).toContain('p-slash-short');
  });

  it('takes the 29th of February only when some century gives that day', async () => {
    const response = await p19.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // 1996 and 2096 are both leap years, and 2000 is one even though 1900 is
    // not — so one century or the other always gives the day.
    expect(touched).toContain('p-leap-possible');
    expect(touched).toContain('p-leap-2000');

    // Neither 1954 nor 2054 had a 29th of February, so no reading of the cell
    // is a date and there is nothing to report that would not be invented.
    expect(touched).not.toContain('p-no-leap');
  });

  it('leaves every four-digit year, and every other cell, alone', async () => {
    const response = await p19.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A four-digit year is P16's, P17's or P18's depending on the order and
    // the separator, and a cell is never asked about twice in the same breath.
    expect(touched).not.toContain('p-four-digit-us');
    expect(touched).not.toContain('p-four-digit-euro');
    expect(touched).not.toContain('p-four-digit-both');

    // A cell that changes separator half way through is none of the spellings
    // the catalogue names.
    expect(touched).not.toContain('p-mixed-separator');

    // No reading of these is a date at all.
    expect(touched).not.toContain('p-no-month');
    expect(touched).not.toContain('p-zero-day');
    expect(touched).not.toContain('p-zero-month');
    expect(touched).not.toContain('p-impossible-day');

    // A leading two-digit year, and a three-digit year: neither is a day and a
    // month followed by a short year, and neither is a spelling the catalogue
    // names.
    expect(touched).not.toContain('p-leading-year');
    expect(touched).not.toContain('p-three-digit-year');

    // Already ISO, or not a date at all, or a separator no entry names.
    expect(touched).not.toContain('p-iso');
    expect(touched).not.toContain('p-iso-slash');
    expect(touched).not.toContain('p-words');
    expect(touched).not.toContain('p-with-time');
    expect(touched).not.toContain('p-four-parts');
    expect(touched).not.toContain('p-space-separated');

    // No date in the column at all, which is P22's finding.
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');

    // And no other column is reported against, whatever it holds (1.1.5) —
    // including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('dob');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p19.run(context);

    // The catalogue marks P19 ambiguous: 54 is 1954 or 2054, a hundred years
    // apart, and nothing in the row carries the century. The flag is rule-wide
    // (1.1.12) — stated once beside the updates — and the `rule` row says the
    // same thing the response does, which is what makes the description the
    // human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p19.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
      expect(update.prev).not.toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p19]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P19', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once a human writes the date they confirmed', async () => {
    const before = await p19.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-dash-short');

    // What resolving an ambiguous finding does: a person who can check the real
    // date of birth writes it in full into the column the rule tested (1.1.5).
    // An ISO date carries a four-digit year, so the rule is self-terminating
    // and the settled row does not come back.
    await patients.update({ legacyPatientId: 'p-dash-short' }, { dob: '1954-04-03' });

    const after = await p19.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-dash-short');

    await patients.update({ legacyPatientId: 'p-dash-short' }, { dob: '03-04-54' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p19.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(FIXTURE_ROWS);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P19 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p19);
    expect(p19.ruleId).toBe('P19');
    expect(p19.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p19.ruleName.length).toBeGreaterThan(0);
    expect(p19.description.length).toBeGreaterThan(0);
  });
});
