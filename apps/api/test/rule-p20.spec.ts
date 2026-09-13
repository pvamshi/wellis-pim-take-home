import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p20 } from '../src/rules/catalogue/p20';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P20 — a patient `dob` that falls after today, against a real database with
 * real rows in it.
 *
 * "After today" is read off the clock, so the clock is held still for every
 * assertion below: only `Date` is faked, and only while a test runs, so the
 * database work in `beforeAll` happens on the real one. Every fixture date is
 * written against the frozen day, which is what lets the boundary — today,
 * tomorrow, yesterday — be asserted at all rather than guessed at.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 39;

/** The day every date in this suite is future or past relative to. Local noon,
 * so the calendar day is the 13th of September 2026 in any timezone. */
const TODAY = new Date('2026-09-13T12:00:00');

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P20 — a patient date of birth in the future', () => {
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
      // What the rule is for, and all four of these are in the real export:
      // a date of birth in a year that has not happened.
      { legacyPatientId: 'p-iso-future', dob: '2059-01-05', rawData: '{}' },
      { legacyPatientId: 'p-iso-far', dob: '2077-02-08', rawData: '{}' },
      { legacyPatientId: 'p-us-certain', dob: '09/13/2060', rawData: '{}' },
      { legacyPatientId: 'p-us-certain-2', dob: '08/22/2044', rawData: '{}' },

      // Also in the export, and the row that decides how this rule reads a
      // two-way date: the 4th of January 2049 and the 1st of April 2049 are
      // both twenty years out, so the cell is in the future without anybody
      // answering P18's question about which was meant.
      { legacyPatientId: 'p-both-future', dob: '01/04/2049', rawData: '{}' },

      // The European spellings, both separators. The future is in the year, not
      // in the punctuation.
      { legacyPatientId: 'p-euro-certain', dob: '13-09-2060', rawData: '{}' },
      { legacyPatientId: 'p-dot-certain', dob: '13.09.2060', rawData: '{}' },

      // The first day this rule reports: tomorrow.
      { legacyPatientId: 'p-tomorrow', dob: '2026-09-14', rawData: '{}' },

      // Padded around the outside, and not zero-padded inside. Neither changes
      // which year the cell names.
      { legacyPatientId: 'p-padded', dob: '  2059-01-05  ', rawData: '{}' },
      { legacyPatientId: 'p-unpadded', dob: '1/4/2049', rawData: '{}' },

      // A real 29th of February in the future — 2048 is a leap year — where the
      // US reading is no date at all because there is no month 29.
      { legacyPatientId: 'p-leap-future', dob: '29-02-2048', rawData: '{}' },

      // Both numbers the same, so both readings are the same day. Still one
      // finding, and still in the future.
      { legacyPatientId: 'p-same-numbers', dob: '07/07/2044', rawData: '{}' },

      // The far end of a four-digit year.
      { legacyPatientId: 'p-far-year', dob: '9999-12-31', rawData: '{}' },

      // Left alone: today is a newborn, not a mistake, and yesterday is an
      // ordinary date of birth. Tomorrow is where the finding starts.
      { legacyPatientId: 'p-today', dob: '2026-09-13', rawData: '{}' },
      { legacyPatientId: 'p-yesterday', dob: '2026-09-12', rawData: '{}' },
      { legacyPatientId: 'p-past-iso', dob: '1983-12-22', rawData: '{}' },
      { legacyPatientId: 'p-past-us', dob: '09/23/1983', rawData: '{}' },

      // Left alone: one reading of each of these is already past and the other
      // is not, so calling the cell a future date would mean choosing the
      // reading that makes the sentence true. Which reading was meant is P18's
      // question. Both orders, so neither is a special case.
      { legacyPatientId: 'p-straddle-us-future', dob: '12/01/2026', rawData: '{}' },
      { legacyPatientId: 'p-straddle-euro-future', dob: '01/12/2026', rawData: '{}' },

      // Left alone: a two-digit year is never certainly in the future, because
      // its 1900s reading has been and gone. Those cells are P19's.
      { legacyPatientId: 'p-short-year', dob: '03-04-49', rawData: '{}' },
      { legacyPatientId: 'p-short-year-slash', dob: '11/09/30', rawData: '{}' },

      // Left alone: no reading of these is a date at all, so there is no date
      // in the cell to be in the future. The 30th of February, the 29th of a
      // February that had 28 days (2047 is not a leap year), a number that is
      // no month on either side, and a zero where a day would go.
      { legacyPatientId: 'p-no-such-day-iso', dob: '2060-02-30', rawData: '{}' },
      { legacyPatientId: 'p-no-such-day-slash', dob: '02/30/2060', rawData: '{}' },
      { legacyPatientId: 'p-no-leap-future', dob: '29-02-2047', rawData: '{}' },
      { legacyPatientId: 'p-no-month', dob: '20-13-2060', rawData: '{}' },
      { legacyPatientId: 'p-zero-day', dob: '00-12-2060', rawData: '{}' },

      // Left alone: spellings no catalogue entry names — a cell that changes
      // separator half way through, a four-digit year leading a slash or a dot
      // date, and an ISO date that is not zero-padded.
      { legacyPatientId: 'p-mixed-separator', dob: '03-04.2060', rawData: '{}' },
      { legacyPatientId: 'p-iso-slash', dob: '2060/09/13', rawData: '{}' },
      { legacyPatientId: 'p-iso-dots', dob: '2060.09.13', rawData: '{}' },
      { legacyPatientId: 'p-iso-unpadded', dob: '2059-1-5', rawData: '{}' },

      // Left alone: not a date at all, a date with something extra stuck to it,
      // a fourth part, and a separator no entry names.
      { legacyPatientId: 'p-words', dob: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-with-time', dob: '2060-01-05 00:00', rawData: '{}' },
      { legacyPatientId: 'p-four-parts', dob: '03-04-20-60', rawData: '{}' },
      { legacyPatientId: 'p-space-separated', dob: '13 09 2060', rawData: '{}' },

      // Left alone: no date in the column at all, which is P22's finding.
      { legacyPatientId: 'p-blank', dob: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', dob: '', rawData: '{}' },
      { legacyPatientId: 'p-null', dob: null, rawData: '{}' },

      // Left alone: future dates written into other columns entirely — the
      // signup date is a real one from the export. P20 tests one column (1.1.5)
      // and this row's dob is an ordinary date of birth.
      {
        legacyPatientId: 'p-other-column',
        dob: '1984-07-03',
        signupDate: '2062-04-07',
        fullName: '2060-09-13',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // dob here is in the past.
      { legacyPatientId: ' p-padded-id ', dob: '1975-06-09', rawData: '{}' },
    ]);
  });

  beforeEach(() => {
    // Only `Date` is faked: the rule reads the clock, and nothing else in the
    // suite should notice. Timers the database driver or Nest may rely on keep
    // working.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TODAY);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('reports every dob that falls after today, and proposes nothing', async () => {
    const response = await p20.run(context);

    // One call, every row (1.1.14). `prev` is the cell exactly as stored —
    // padding, separator and all — because the cell as written is what the
    // human reads alongside the real date of birth they check. `next` is null
    // on all of them, which is what an ambiguous rule returns (1.1.12).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-both-future',
        column: 'dob',
        prev: '01/04/2049',
        // Both readings are in 2049, so the cell is in the future whichever way
        // round it was meant. Which way round is still P18's question, and no
        // date is proposed here either way.
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-dot-certain',
        column: 'dob',
        prev: '13.09.2060',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-euro-certain',
        column: 'dob',
        prev: '13-09-2060',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-far-year',
        column: 'dob',
        prev: '9999-12-31',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-iso-far',
        column: 'dob',
        prev: '2077-02-08',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-iso-future',
        column: 'dob',
        prev: '2059-01-05',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-leap-future',
        column: 'dob',
        prev: '29-02-2048',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'dob',
        prev: '  2059-01-05  ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-same-numbers',
        column: 'dob',
        prev: '07/07/2044',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-tomorrow',
        column: 'dob',
        prev: '2026-09-14',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-unpadded',
        column: 'dob',
        prev: '1/4/2049',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-us-certain',
        column: 'dob',
        prev: '09/13/2060',
        // P16 proposes `2060-09-13` for this same cell, because the order of
        // its two numbers is certain. That the date is still in the future is
        // this rule's separate sentence about the same column (1.1.4).
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-us-certain-2',
        column: 'dob',
        prev: '08/22/2044',
        next: null,
      },
    ]);
  });

  it('addresses each finding by the row it read the date from', async () => {
    const response = await p20.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `dob`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the date it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.dob).toBe(update.prev);
    }
  });

  it('reports a future date in every spelling the catalogue names', async () => {
    const response = await p20.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Being in the future is a fact about the date, not about the punctuation,
    // so ISO and all three day-and-month separators are one finding (1.1.4) —
    // including the cells P16 and P17 also propose an ISO spelling for.
    expect(touched).toContain('p-iso-future');
    expect(touched).toContain('p-us-certain');
    expect(touched).toContain('p-euro-certain');
    expect(touched).toContain('p-dot-certain');
  });

  it('takes a two-way date only when both readings are in the future', async () => {
    const response = await p20.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // `01/04/2049` is the 4th of January or the 1st of April, and both are
    // years away, so the cell is in the future without this rule choosing.
    expect(touched).toContain('p-both-future');
    expect(touched).toContain('p-same-numbers');

    // `12/01/2026` is next December one way round and last January the other.
    // Reporting it would mean picking the reading that makes the finding true,
    // and the cell does not say which was meant — that is P18's question.
    expect(touched).not.toContain('p-straddle-us-future');
    expect(touched).not.toContain('p-straddle-euro-future');
  });

  it('draws the line at today, and starts at the day after it', async () => {
    const response = await p20.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A date of birth of today is a newborn. Tomorrow is the first day nobody
    // can have been born on.
    expect(touched).not.toContain('p-today');
    expect(touched).not.toContain('p-yesterday');
    expect(touched).toContain('p-tomorrow');
  });

  it('judges every row in one response against the same day', async () => {
    const response = await p20.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // The clock is read once per run, before the rows, so the boundary rows
    // cannot land on different sides of midnight from each other.
    expect(touched).toContain('p-tomorrow');
    expect(touched).not.toContain('p-today');

    // And the finding is the clock's, not the fixture's: with the same rows
    // read a day later, today's date is yesterday's and stops being reported —
    // while the row that was already past stays past.
    vi.setSystemTime(new Date('2026-09-15T12:00:00'));

    const later = await p20.run(context);
    const touchedLater = later.updates.map((update) => update.legacyId);

    expect(touchedLater).not.toContain('p-tomorrow');
    expect(touchedLater).not.toContain('p-today');
    expect(touchedLater).toContain('p-iso-future');
  });

  it('leaves a two-digit year to P19', async () => {
    const response = await p20.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // `03-04-49` is 1949 or 2049, and 1949 has been and gone — so no reading of
    // the cell makes the future certain. Striking the 1900s out would be
    // proposing the 2000s, which is the one thing this rule does not do.
    expect(touched).not.toContain('p-short-year');
    expect(touched).not.toContain('p-short-year-slash');
  });

  it('leaves every cell that is not a date, and every other cell, alone', async () => {
    const response = await p20.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A cell that is no date in any reading is not a date in the future, and
    // inventing one is not a finding.
    expect(touched).not.toContain('p-no-such-day-iso');
    expect(touched).not.toContain('p-no-such-day-slash');
    expect(touched).not.toContain('p-no-leap-future');
    expect(touched).not.toContain('p-no-month');
    expect(touched).not.toContain('p-zero-day');

    // Spellings no catalogue entry names, here or in P16, P17, P18 and P19.
    expect(touched).not.toContain('p-mixed-separator');
    expect(touched).not.toContain('p-iso-slash');
    expect(touched).not.toContain('p-iso-dots');
    expect(touched).not.toContain('p-iso-unpadded');

    // Ordinary dates of birth, and cells that are not dates at all.
    expect(touched).not.toContain('p-past-iso');
    expect(touched).not.toContain('p-past-us');
    expect(touched).not.toContain('p-words');
    expect(touched).not.toContain('p-with-time');
    expect(touched).not.toContain('p-four-parts');
    expect(touched).not.toContain('p-space-separated');

    // No date in the column at all, which is P22's finding.
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');

    // And no other column is reported against, whatever it holds (1.1.5) —
    // including the row whose signup date is in the future, and the padded
    // legacy id, which is P01's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('dob');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p20.run(context);

    // The catalogue marks P20 ambiguous: a year that has not happened yet
    // cannot be corrected from the row, because nothing in the row says which
    // year was meant. The flag is rule-wide (1.1.12) — stated once beside the
    // updates — and the `rule` row says the same thing the response does, which
    // is what makes the description the human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p20.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
      expect(update.prev).not.toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p20]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P20', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once a human writes the date they confirmed', async () => {
    const before = await p20.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-iso-future');

    // What resolving an ambiguous finding does: a person who can check the real
    // date of birth writes it into the column the rule tested (1.1.5). A date
    // of birth is in the past, so the settled row does not come back.
    await patients.update({ legacyPatientId: 'p-iso-future' }, { dob: '1959-01-05' });

    const after = await p20.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-iso-future');

    await patients.update({ legacyPatientId: 'p-iso-future' }, { dob: '2059-01-05' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p20.run(context);

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

  it('is registered in the catalogue as P20 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p20);
    expect(p20.ruleId).toBe('P20');
    expect(p20.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p20.ruleName.length).toBeGreaterThan(0);
    expect(p20.description.length).toBeGreaterThan(0);
  });
});
