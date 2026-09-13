import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p21 } from '../src/rules/catalogue/p21';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P21 — a patient `dob` implying an age under 18 or over 100, against a real
 * database with real rows in it.
 *
 * An age is measured from the clock, so the clock is held still for every
 * assertion below: only `Date` is faked, and only while a test runs, so the
 * database work in `beforeAll` happens on the real one. Every fixture date is
 * written against the frozen day, which is what lets the two boundaries — the
 * eighteenth birthday and the hundred-and-first — be asserted at all rather
 * than guessed at.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 48;

/** The day every age in this suite is measured against. Local noon, so the
 * calendar day is the 13th of September 2026 in any timezone. */
const TODAY = new Date('2026-09-13T12:00:00');

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P21 — a patient date of birth implying an age under 18 or over 100', () => {
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
      // What the rule is for at the young end, and both of these are in the
      // real export: an ISO date, spelled perfectly, naming a seventeen-year-old.
      { legacyPatientId: 'p-teen-iso', dob: '2009-02-15', rawData: '{}' },
      { legacyPatientId: 'p-teen-iso-2', dob: '2009-03-20', rawData: '{}' },

      // The last day of being seventeen: the eighteenth birthday is tomorrow.
      { legacyPatientId: 'p-turns-18-tomorrow', dob: '2008-09-14', rawData: '{}' },

      // Children, in the three day-and-month spellings. The age is in the year,
      // not in the punctuation, and each of these reads only one way round.
      { legacyPatientId: 'p-child-euro', dob: '30-12-2015', rawData: '{}' },
      { legacyPatientId: 'p-child-us', dob: '04/22/2018', rawData: '{}' },
      { legacyPatientId: 'p-child-dot', dob: '14.06.2014', rawData: '{}' },

      // A two-way date whose readings are both children of eleven, so the
      // finding is true of the cell without anybody answering P18's question.
      { legacyPatientId: 'p-both-young', dob: '01/04/2015', rawData: '{}' },

      // Born today. Not a date in the future, so P20 walks past it; a newborn
      // is still not a patient this register holds.
      { legacyPatientId: 'p-newborn-today', dob: '2026-09-13', rawData: '{}' },

      // Padded around the outside, and not zero-padded inside. Neither changes
      // the age the cell implies.
      { legacyPatientId: 'p-padded', dob: '  2009-02-15  ', rawData: '{}' },
      { legacyPatientId: 'p-unpadded', dob: '1/4/2015', rawData: '{}' },

      // What the rule is for at the old end. `05/14/1890` is the row P16 also
      // proposes an ISO spelling for — that the order is certain is P16's
      // sentence, and that the age is a hundred and thirty-six is this one's.
      { legacyPatientId: 'p-ancient-us', dob: '05/14/1890', rawData: '{}' },
      { legacyPatientId: 'p-ancient-iso', dob: '1899-12-31', rawData: '{}' },

      // A hundred and one yesterday: the first day past the line.
      { legacyPatientId: 'p-just-over-100', dob: '1925-09-12', rawData: '{}' },

      // A two-way date whose readings are both a hundred and twenty-six, and a
      // real leap day in a leap year that reads only the European way round.
      { legacyPatientId: 'p-both-old', dob: '01/04/1900', rawData: '{}' },
      { legacyPatientId: 'p-leap-old', dob: '29-02-1904', rawData: '{}' },

      // Left alone: eighteen exactly is an adult the service treats, whether the
      // birthday was today or last week. A hundred exactly is an age people
      // reach, including on the day before the hundred-and-first birthday.
      { legacyPatientId: 'p-exactly-18', dob: '2008-09-13', rawData: '{}' },
      { legacyPatientId: 'p-just-18', dob: '2008-09-12', rawData: '{}' },
      { legacyPatientId: 'p-exactly-100', dob: '1926-09-13', rawData: '{}' },
      { legacyPatientId: 'p-turns-101-tomorrow', dob: '1925-09-14', rawData: '{}' },

      // Left alone: ordinary dates of birth, two of them straight out of the
      // export, one of which is a two-way date that is fifty-four either way.
      { legacyPatientId: 'p-ordinary-iso', dob: '1983-12-22', rawData: '{}' },
      { legacyPatientId: 'p-ordinary-euro', dob: '23-08-2000', rawData: '{}' },
      { legacyPatientId: 'p-ordinary-two-way', dob: '03/04/1972', rawData: '{}' },

      // Left alone: one reading is out of range and the other is not, so
      // reporting the cell would mean picking the reading that makes the
      // sentence true. `12/01/2008` is seventeen as the first of December and
      // eighteen as the twelfth of January; `12/01/1925` is a hundred one way
      // and a hundred and one the other. Which was meant is P18's question.
      { legacyPatientId: 'p-straddle-18', dob: '12/01/2008', rawData: '{}' },
      { legacyPatientId: 'p-straddle-100', dob: '12/01/1925', rawData: '{}' },

      // Left alone: a date that has not happened implies no age at all, because
      // the patient would not be born. All three are in the export and all three
      // are P20's finding, whole.
      { legacyPatientId: 'p-future-iso', dob: '2059-01-05', rawData: '{}' },
      { legacyPatientId: 'p-future-both', dob: '01/04/2049', rawData: '{}' },
      { legacyPatientId: 'p-future-us', dob: '09/13/2060', rawData: '{}' },

      // Left alone: one reading is this coming December and the other is last
      // January. Measuring an age off the reading that happens to be in the past
      // would be answering P18's question in order to make this rule fire.
      { legacyPatientId: 'p-straddle-future', dob: '12/01/2026', rawData: '{}' },

      // Left alone: a two-digit year is a patient of seventy-seven or somebody
      // not yet born, and choosing between them is choosing a century. P19's.
      { legacyPatientId: 'p-short-year', dob: '03-04-49', rawData: '{}' },
      { legacyPatientId: 'p-short-year-slash', dob: '11/09/09', rawData: '{}' },

      // Left alone: no reading of these is a date at all, so there is no date in
      // the cell to imply an age. The 30th of February, the 29th of a February
      // that had 28 days, a number that is no month on either side, and a zero
      // where a day would go.
      { legacyPatientId: 'p-no-such-day-iso', dob: '2015-02-30', rawData: '{}' },
      { legacyPatientId: 'p-no-such-day-slash', dob: '02/30/2015', rawData: '{}' },
      { legacyPatientId: 'p-no-leap', dob: '29-02-2015', rawData: '{}' },
      { legacyPatientId: 'p-no-month', dob: '20-13-2015', rawData: '{}' },
      { legacyPatientId: 'p-zero-day', dob: '00-12-2015', rawData: '{}' },

      // Left alone: spellings no catalogue entry names — a cell that changes
      // separator half way through, a four-digit year leading a slash or a dot
      // date, and an ISO date that is not zero-padded.
      { legacyPatientId: 'p-mixed-separator', dob: '03-04.2015', rawData: '{}' },
      { legacyPatientId: 'p-iso-slash', dob: '2015/09/13', rawData: '{}' },
      { legacyPatientId: 'p-iso-dots', dob: '2015.09.13', rawData: '{}' },
      { legacyPatientId: 'p-iso-unpadded', dob: '2009-2-15', rawData: '{}' },

      // Left alone: not a date at all, a date with something extra stuck to it,
      // a fourth part, and a separator no entry names.
      { legacyPatientId: 'p-words', dob: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-with-time', dob: '2009-02-15 00:00', rawData: '{}' },
      { legacyPatientId: 'p-four-parts', dob: '03-04-20-15', rawData: '{}' },
      { legacyPatientId: 'p-space-separated', dob: '13 09 2015', rawData: '{}' },

      // Left alone: no date in the column at all, which is P22's finding.
      { legacyPatientId: 'p-blank', dob: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', dob: '', rawData: '{}' },
      { legacyPatientId: 'p-null', dob: null, rawData: '{}' },

      // Left alone: a teenager's date written into other columns entirely. P21
      // tests one column (1.1.5) and this row's dob is an ordinary one.
      {
        legacyPatientId: 'p-other-column',
        dob: '1984-07-03',
        signupDate: '2009-02-15',
        fullName: '2009-02-15',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // age this row implies is an ordinary one.
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

  it('reports every dob implying an age under 18 or over 100, and proposes nothing', async () => {
    const response = await p21.run(context);

    // One call, every row (1.1.14). `prev` is the cell exactly as stored —
    // padding, separator and all — because the cell as written is what the
    // human reads alongside the real date of birth they check. `next` is null
    // on all of them, which is what an ambiguous rule returns (1.1.12).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-ancient-iso',
        column: 'dob',
        prev: '1899-12-31',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-ancient-us',
        column: 'dob',
        prev: '05/14/1890',
        // P16 proposes `1890-05-14` for this same cell, because the order of its
        // two numbers is certain. That the age is a hundred and thirty-six is
        // this rule's separate sentence about the same column (1.1.4).
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-both-old',
        column: 'dob',
        prev: '01/04/1900',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-both-young',
        column: 'dob',
        prev: '01/04/2015',
        // Eleven years old read either way round, so the cell is out of range
        // whichever way it was meant. Which way is still P18's question.
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-child-dot',
        column: 'dob',
        prev: '14.06.2014',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-child-euro',
        column: 'dob',
        prev: '30-12-2015',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-child-us',
        column: 'dob',
        prev: '04/22/2018',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-just-over-100',
        column: 'dob',
        prev: '1925-09-12',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-leap-old',
        column: 'dob',
        prev: '29-02-1904',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-newborn-today',
        column: 'dob',
        prev: '2026-09-13',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'dob',
        prev: '  2009-02-15  ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-teen-iso',
        column: 'dob',
        prev: '2009-02-15',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-teen-iso-2',
        column: 'dob',
        prev: '2009-03-20',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-turns-18-tomorrow',
        column: 'dob',
        prev: '2008-09-14',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-unpadded',
        column: 'dob',
        prev: '1/4/2015',
        next: null,
      },
    ]);
  });

  it('addresses each finding by the row it read the date from', async () => {
    const response = await p21.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `dob`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the date it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.dob).toBe(update.prev);
    }
  });

  it('catches both ends of the range, in every spelling the catalogue names', async () => {
    const response = await p21.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Too young and too old are one sentence about one column, so they are one
    // rule (1.1.4) — and the age is a fact about the date, not about the
    // punctuation, so ISO and all three day-and-month separators are in it.
    expect(touched).toContain('p-teen-iso');
    expect(touched).toContain('p-child-us');
    expect(touched).toContain('p-child-euro');
    expect(touched).toContain('p-child-dot');
    expect(touched).toContain('p-ancient-iso');
    expect(touched).toContain('p-ancient-us');
    expect(touched).toContain('p-leap-old');
  });

  it('draws the line at eighteen and at a hundred, and includes neither', async () => {
    const response = await p21.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Eighteen is an adult the service treats, on the birthday itself and after
    // it. Seventeen — a birthday one day away — is the first age reported.
    expect(touched).not.toContain('p-exactly-18');
    expect(touched).not.toContain('p-just-18');
    expect(touched).toContain('p-turns-18-tomorrow');

    // A hundred is an age people reach, on the birthday and in the year running
    // up to the next one. A hundred and one is the first age reported.
    expect(touched).not.toContain('p-exactly-100');
    expect(touched).not.toContain('p-turns-101-tomorrow');
    expect(touched).toContain('p-just-over-100');
  });

  it('takes a two-way date only when both readings are out of range', async () => {
    const response = await p21.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // `01/04/2015` is eleven and `01/04/1900` is a hundred and twenty-six
    // whichever way round their day and month are read, so neither finding
    // depends on choosing a reading.
    expect(touched).toContain('p-both-young');
    expect(touched).toContain('p-both-old');

    // `12/01/2008` is seventeen one way round and eighteen the other, and
    // `12/01/1925` straddles the far boundary the same way. Reporting either
    // would mean picking the reading that makes the sentence true — which is
    // P18's question, not this rule's.
    expect(touched).not.toContain('p-straddle-18');
    expect(touched).not.toContain('p-straddle-100');
  });

  it('leaves a date in the future to P20, and a two-digit year to P19', async () => {
    const response = await p21.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A day that has not happened implies no age at all — the patient would not
    // be born — so there is nothing here to measure.
    expect(touched).not.toContain('p-future-iso');
    expect(touched).not.toContain('p-future-both');
    expect(touched).not.toContain('p-future-us');
    expect(touched).not.toContain('p-straddle-future');

    // `03-04-49` is seventy-seven as 1949 and unborn as 2049. Measuring an age
    // off one of those is choosing a century, which is the thing P19 says
    // nobody here can do.
    expect(touched).not.toContain('p-short-year');
    expect(touched).not.toContain('p-short-year-slash');
  });

  it('measures every row in one response against the same day', async () => {
    const response = await p21.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // The clock is read once per run, before the rows, so two boundary rows
    // cannot land on different sides of midnight from each other.
    expect(touched).toContain('p-turns-18-tomorrow');
    expect(touched).not.toContain('p-exactly-18');
    expect(touched).not.toContain('p-turns-101-tomorrow');

    // And the finding is the clock's, not the fixture's: with the same rows read
    // a day later, the seventeen-year-old has had a birthday and stops being
    // reported, while the hundred-year-old has had one too and starts.
    vi.setSystemTime(new Date('2026-09-14T12:00:00'));

    const later = await p21.run(context);
    const touchedLater = later.updates.map((update) => update.legacyId);

    expect(touchedLater).not.toContain('p-turns-18-tomorrow');
    expect(touchedLater).toContain('p-turns-101-tomorrow');
    expect(touchedLater).toContain('p-teen-iso');
  });

  it('leaves every cell that is not a date, and every other cell, alone', async () => {
    const response = await p21.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A cell that is no date in any reading implies no age, and inventing one
    // is not a finding.
    expect(touched).not.toContain('p-no-such-day-iso');
    expect(touched).not.toContain('p-no-such-day-slash');
    expect(touched).not.toContain('p-no-leap');
    expect(touched).not.toContain('p-no-month');
    expect(touched).not.toContain('p-zero-day');

    // Spellings no catalogue entry names, here or in P16, P17, P18 and P19.
    expect(touched).not.toContain('p-mixed-separator');
    expect(touched).not.toContain('p-iso-slash');
    expect(touched).not.toContain('p-iso-dots');
    expect(touched).not.toContain('p-iso-unpadded');

    // Ordinary dates of birth, and cells that are not dates at all.
    expect(touched).not.toContain('p-ordinary-iso');
    expect(touched).not.toContain('p-ordinary-euro');
    expect(touched).not.toContain('p-ordinary-two-way');
    expect(touched).not.toContain('p-words');
    expect(touched).not.toContain('p-with-time');
    expect(touched).not.toContain('p-four-parts');
    expect(touched).not.toContain('p-space-separated');

    // No date in the column at all, which is P22's finding.
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');

    // And no other column is reported against, whatever it holds (1.1.5) —
    // including the row carrying a teenager's date in two other columns, and the
    // padded legacy id, which is P01's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('dob');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p21.run(context);

    // The catalogue marks P21 ambiguous: an implausible age cannot be corrected
    // from the row, because nothing in the row says which part of the date is
    // wrong — or whether the date is right and the patient is the problem. The
    // flag is rule-wide (1.1.12) — stated once beside the updates — and the
    // `rule` row says the same thing the response does, which is what makes the
    // description the human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p21.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
      expect(update.prev).not.toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p21]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P21', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once a human writes the date they confirmed', async () => {
    const before = await p21.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-teen-iso');

    // What resolving an ambiguous finding does: a person who can check the real
    // date of birth writes it into the column the rule tested (1.1.5). The year
    // that was mistyped turns out to be 1979, and the settled row does not come
    // back.
    await patients.update({ legacyPatientId: 'p-teen-iso' }, { dob: '1979-02-15' });

    const after = await p21.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-teen-iso');

    await patients.update({ legacyPatientId: 'p-teen-iso' }, { dob: '2009-02-15' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p21.run(context);

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

  it('is registered in the catalogue as P21 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p21);
    expect(p21.ruleId).toBe('P21');
    expect(p21.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p21.ruleName.length).toBeGreaterThan(0);
    expect(p21.description.length).toBeGreaterThan(0);
  });
});
