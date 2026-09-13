import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p17 } from '../src/rules/catalogue/p17';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P17 — a patient `dob` written European-style, `DD-MM-YYYY` or `DD.MM.YYYY`,
 * where the first number is above 12 and the order is therefore certain,
 * against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P17 — a patient date of birth in European order, unambiguously', () => {
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
      // What the rule is for: the first number is above 12, so it cannot be a
      // month and the order is certain. These are the shapes that are actually
      // in the export.
      { legacyPatientId: 'p-euro-aug', dob: '14-08-1982', rawData: '{}' },
      { legacyPatientId: 'p-euro-dec', dob: '31-12-1968', rawData: '{}' },
      { legacyPatientId: 'p-euro-jan', dob: '20-01-1971', rawData: '{}' },
      // The last day of a 30-day month, the first day that settles the order,
      // 13, and December, the last month.
      { legacyPatientId: 'p-euro-last-30', dob: '30-06-1970', rawData: '{}' },
      { legacyPatientId: 'p-euro-thirteen', dob: '13-06-1985', rawData: '{}' },
      { legacyPatientId: 'p-euro-december', dob: '25-12-1980', rawData: '{}' },

      // The dot spelling, which the catalogue names beside the dash one and
      // which this rule reads exactly the same way round.
      { legacyPatientId: 'p-dot-aug', dob: '14.08.1982', rawData: '{}' },
      { legacyPatientId: 'p-dot-dec', dob: '31.12.1968', rawData: '{}' },

      // Not zero-padded. The same date, written the same way round, by an
      // automation that did not pad — the order is what makes the reading
      // certain, not the padding.
      { legacyPatientId: 'p-short-month', dob: '23-7-1961', rawData: '{}' },

      // Padded cell. The whole cell becomes the ISO date, because the fix is
      // the date rewritten and not a piece of the old spelling edited.
      { legacyPatientId: 'p-padded', dob: '  28-03-1988  ', rawData: '{}' },

      // A leap day that existed, in a year divisible by 4 and in one divisible
      // by 400.
      { legacyPatientId: 'p-leap-1980', dob: '29-02-1980', rawData: '{}' },
      { legacyPatientId: 'p-leap-2000', dob: '29-02-2000', rawData: '{}' },

      // A future date, and an implausible age. The order is still certain, so
      // the ISO spelling is still proposed — that the year is ahead of us is
      // P20's sentence about the same column, and the age is P21's.
      { legacyPatientId: 'p-future', dob: '23-07-2090', rawData: '{}' },
      { legacyPatientId: 'p-ancient', dob: '14-05-1890', rawData: '{}' },

      // Left alone: both numbers are 12 or under, so day-first and month-first
      // readings both parse. That is P18's finding and it is ambiguous on
      // purpose — on the dot spelling exactly as on the dash one.
      { legacyPatientId: 'p-both-under', dob: '03-04-1989', rawData: '{}' },
      { legacyPatientId: 'p-both-under-edge', dob: '12-11-1995', rawData: '{}' },
      { legacyPatientId: 'p-both-ones', dob: '01-01-1980', rawData: '{}' },
      { legacyPatientId: 'p-dot-both-under', dob: '03.04.1989', rawData: '{}' },

      // Left alone: the second number is not a month, so the day-first reading
      // does not parse either and there is nothing to propose that would not be
      // invented. A zero in either place is no date either way round.
      { legacyPatientId: 'p-no-month', dob: '20-13-1971', rawData: '{}' },
      { legacyPatientId: 'p-zero-month', dob: '20-00-1975', rawData: '{}' },
      { legacyPatientId: 'p-zero-day', dob: '00-12-1975', rawData: '{}' },

      // Left alone: a dash or dot date whose second number is above 12 is not
      // `DD-MM-YYYY` — there is no month 14. The catalogue gives the US order
      // to the slash spelling and nothing else, so this rule invents no reading
      // for it.
      { legacyPatientId: 'p-us-order-dash', dob: '08-14-1982', rawData: '{}' },
      { legacyPatientId: 'p-us-order-dot', dob: '08.14.1982', rawData: '{}' },

      // Left alone: the order is certain and the day does not exist. There is
      // no ISO date to propose.
      { legacyPatientId: 'p-feb-30', dob: '30-02-1990', rawData: '{}' },
      { legacyPatientId: 'p-apr-31', dob: '31-04-1990', rawData: '{}' },
      { legacyPatientId: 'p-not-leap', dob: '29-02-1997', rawData: '{}' },
      { legacyPatientId: 'p-not-leap-1900', dob: '29-02-1900', rawData: '{}' },
      { legacyPatientId: 'p-day-32', dob: '32-01-1990', rawData: '{}' },

      // Left alone: slashes are P16's spelling, in either order, and a cell
      // that changes separator half way through is neither spelling this rule
      // names.
      { legacyPatientId: 'p-slash-euro', dob: '16/02/1962', rawData: '{}' },
      { legacyPatientId: 'p-slash-us', dob: '02/16/1962', rawData: '{}' },
      { legacyPatientId: 'p-mixed-separator', dob: '14-08.1982', rawData: '{}' },

      // Left alone: a two-digit year is P19's, because 82 is 1982 or 2082 and
      // the cell does not say.
      { legacyPatientId: 'p-two-digit-year', dob: '31-12-68', rawData: '{}' },
      { legacyPatientId: 'p-two-digit-year-pair', dob: '14-08-82', rawData: '{}' },

      // Left alone: already ISO, which is what this rule produces — dashes and
      // all, which is why the year has to be read as a year and not as a day.
      { legacyPatientId: 'p-iso', dob: '2000-01-22', rawData: '{}' },
      { legacyPatientId: 'p-iso-dots', dob: '2000.01.22', rawData: '{}' },

      // Left alone: not a date at all, and a date with something extra stuck
      // to it. Neither is three numbers on one separator.
      { legacyPatientId: 'p-words', dob: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-with-time', dob: '14-08-1982 00:00', rawData: '{}' },
      { legacyPatientId: 'p-four-parts', dob: '14-08-19-82', rawData: '{}' },

      // Left alone: no date in the column at all, which is P22's finding.
      { legacyPatientId: 'p-blank', dob: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', dob: '', rawData: '{}' },
      { legacyPatientId: 'p-null', dob: null, rawData: '{}' },

      // Left alone: a European date written into another column entirely. P17
      // tests one column (1.1.5) and this row's dob is already ISO.
      {
        legacyPatientId: 'p-other-column',
        dob: '1984-07-03',
        signupDate: '14-08-1982',
        fullName: '14-08-1982',
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

  it('proposes the ISO date for every European-style dob whose order is certain', async () => {
    const response = await p17.run(context);

    // The value matters, not just that the rule fired: each `next` is the one
    // date the cell can mean, written year-month-day. One call, every row
    // (1.1.14), and `column` is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-ancient',
        column: 'dob',
        prev: '14-05-1890',
        // An implied age over 100 is P21's finding about the same column. The
        // order here is still certain, so the date is still rewritten.
        next: '1890-05-14',
      },
      {
        table: 'patient',
        legacyId: 'p-dot-aug',
        column: 'dob',
        prev: '14.08.1982',
        // The dot spelling reads exactly like the dash one, and produces the
        // same ISO date.
        next: '1982-08-14',
      },
      {
        table: 'patient',
        legacyId: 'p-dot-dec',
        column: 'dob',
        prev: '31.12.1968',
        next: '1968-12-31',
      },
      {
        table: 'patient',
        legacyId: 'p-euro-aug',
        column: 'dob',
        prev: '14-08-1982',
        next: '1982-08-14',
      },
      {
        table: 'patient',
        legacyId: 'p-euro-dec',
        column: 'dob',
        prev: '31-12-1968',
        next: '1968-12-31',
      },
      {
        table: 'patient',
        legacyId: 'p-euro-december',
        column: 'dob',
        prev: '25-12-1980',
        next: '1980-12-25',
      },
      {
        table: 'patient',
        legacyId: 'p-euro-jan',
        column: 'dob',
        prev: '20-01-1971',
        next: '1971-01-20',
      },
      {
        table: 'patient',
        legacyId: 'p-euro-last-30',
        column: 'dob',
        prev: '30-06-1970',
        next: '1970-06-30',
      },
      {
        table: 'patient',
        legacyId: 'p-euro-thirteen',
        column: 'dob',
        prev: '13-06-1985',
        // 13 is the first number that cannot be a month, and so the first day
        // this rule will touch.
        next: '1985-06-13',
      },
      {
        table: 'patient',
        legacyId: 'p-future',
        column: 'dob',
        prev: '23-07-2090',
        // A date in the future is P20's finding about the same column, not a
        // reason for this rule to leave the spelling wrong.
        next: '2090-07-23',
      },
      {
        table: 'patient',
        legacyId: 'p-leap-1980',
        column: 'dob',
        prev: '29-02-1980',
        next: '1980-02-29',
      },
      {
        table: 'patient',
        legacyId: 'p-leap-2000',
        column: 'dob',
        prev: '29-02-2000',
        next: '2000-02-29',
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'dob',
        prev: '  28-03-1988  ',
        // The padding is part of the spelling being replaced: the whole cell
        // becomes the date, not the old cell with one piece edited.
        next: '1988-03-28',
      },
      {
        table: 'patient',
        legacyId: 'p-short-month',
        column: 'dob',
        prev: '23-7-1961',
        // Zero-padded on the way out, because that is what an ISO date is.
        next: '1961-07-23',
      },
    ]);
  });

  it('addresses each finding by the row it read the date from', async () => {
    const response = await p17.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `dob`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the date it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.dob).toBe(update.prev);
    }
  });

  it('leaves every date whose order is not certain, and every other cell, alone', async () => {
    const response = await p17.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Both numbers 12 or under: day-first and month-first readings both parse,
    // so the cell has two meanings and P18 asks a human which. This is the line
    // that lets P17 propose a value at all.
    expect(touched).not.toContain('p-both-under');
    expect(touched).not.toContain('p-both-under-edge');
    expect(touched).not.toContain('p-both-ones');
    expect(touched).not.toContain('p-dot-both-under');

    // The second number is not a month, so the day-first reading does not
    // parse either.
    expect(touched).not.toContain('p-no-month');
    expect(touched).not.toContain('p-zero-month');
    expect(touched).not.toContain('p-zero-day');

    // A dash or dot date in US order is not `DD-MM-YYYY`: the catalogue gives
    // that order to the slash spelling, and this rule invents no reading.
    expect(touched).not.toContain('p-us-order-dash');
    expect(touched).not.toContain('p-us-order-dot');

    // The order is certain and the day does not exist, so there is no ISO date
    // to propose. Leap years are counted properly in both directions.
    expect(touched).not.toContain('p-feb-30');
    expect(touched).not.toContain('p-apr-31');
    expect(touched).not.toContain('p-not-leap');
    expect(touched).not.toContain('p-not-leap-1900');
    expect(touched).not.toContain('p-day-32');

    // Slashes are P16's spelling, in either order, and a cell that changes
    // separator half way through is neither spelling this rule names.
    expect(touched).not.toContain('p-slash-euro');
    expect(touched).not.toContain('p-slash-us');
    expect(touched).not.toContain('p-mixed-separator');

    // A two-digit year is P19's: the century is not in the cell.
    expect(touched).not.toContain('p-two-digit-year');
    expect(touched).not.toContain('p-two-digit-year-pair');

    // Already ISO, or not a date at all.
    expect(touched).not.toContain('p-iso');
    expect(touched).not.toContain('p-iso-dots');
    expect(touched).not.toContain('p-words');
    expect(touched).not.toContain('p-with-time');
    expect(touched).not.toContain('p-four-parts');

    // No date in the column at all, which is P22's finding.
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');

    // And no other column is proposed against, whatever it holds (1.1.5) —
    // including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('dob');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries a real ISO date', async () => {
    const response = await p17.run(context);

    // The catalogue does not mark P17 ambiguous: a number above 12 cannot be a
    // month, so the cell has one reading and the rule reads it rather than
    // guessing. The flag is rule-wide (1.1.12), stated once beside the updates,
    // and the `rule` row says the same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p17.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);

      const proposed = update.next ?? '';

      // Every proposal is `YYYY-MM-DD`, and names the day it was read from —
      // same year, and the two numbers of the cell swapped into ISO order,
      // whichever of the two separators the cell used.
      expect(proposed).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const [day, month, year] = (update.prev ?? '').trim().split(/[-.]/);
      expect(proposed).toBe(
        `${year}-${month?.padStart(2, '0') ?? ''}-${day?.padStart(2, '0') ?? ''}`,
      );

      // And it is a date that exists: SQLite parses it, and reads the same day
      // back out.
      const [checked] = await dataSource.query<{ iso: string | null }[]>(`SELECT date(?) AS iso`, [
        proposed,
      ]);
      expect(checked?.iso).toBe(proposed);
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p17.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-euro-aug');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). An ISO date leads with a four-digit year, so the rule is
    // self-terminating and the applied row needs no guard to keep it from being
    // re-proposed.
    await patients.update({ legacyPatientId: 'p-euro-aug' }, { dob: '1982-08-14' });

    const after = await p17.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-euro-aug');

    await patients.update({ legacyPatientId: 'p-euro-aug' }, { dob: '14-08-1982' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p17.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(43);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P17 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p17);
    expect(p17.ruleId).toBe('P17');
    expect(p17.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p17.ruleName.length).toBeGreaterThan(0);
    expect(p17.description.length).toBeGreaterThan(0);
  });
});
