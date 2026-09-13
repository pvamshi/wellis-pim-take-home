import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p18 } from '../src/rules/catalogue/p18';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P18 — a patient `dob` whose two leading numbers are both 12 or under, so the
 * US and the European reading are both dates, against a real database with real
 * rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 33;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P18 — a patient date of birth that reads as a date both ways round', () => {
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
      // What the rule is for: both numbers are 12 or under, so the cell is a
      // real date read either way round and nothing in it says which was
      // meant. The slash spelling is the one P16 leaves behind.
      { legacyPatientId: 'p-slash-both', dob: '03/04/1989', rawData: '{}' },
      { legacyPatientId: 'p-slash-edge', dob: '12/11/1995', rawData: '{}' },
      { legacyPatientId: 'p-slash-ones', dob: '01/01/1980', rawData: '{}' },

      // The dash and dot spellings, which P17 leaves behind for exactly the
      // same reason. The ambiguity is in the numbers, not the punctuation, so
      // all three spellings are one finding with one sentence about it.
      { legacyPatientId: 'p-dash-both', dob: '03-04-1989', rawData: '{}' },
      { legacyPatientId: 'p-dash-edge', dob: '11-12-1995', rawData: '{}' },
      { legacyPatientId: 'p-dot-both', dob: '03.04.1989', rawData: '{}' },

      // 12 is the last number that can be a month, on both sides at once.
      { legacyPatientId: 'p-twelve-twelve', dob: '12-12-1972', rawData: '{}' },

      // Not zero-padded, and padded around the outside. Neither changes the two
      // numbers, so neither changes the finding.
      { legacyPatientId: 'p-unpadded', dob: '3-4-1989', rawData: '{}' },
      { legacyPatientId: 'p-padded', dob: '  05/06/1977  ', rawData: '{}' },

      // Both numbers the same: the two readings agree on the day, and the order
      // is still not recoverable. Reported anyway — ambiguity is rule-wide
      // (1.1.12), and P16 and P17 both walk past this row, so excluding it here
      // would leave a non-ISO date that no rule ever mentions.
      { legacyPatientId: 'p-same-number', dob: '07/07/1984', rawData: '{}' },

      // A future date, and an implausible age. Both readings still parse, so
      // both rows are still this rule's question — that the year is ahead of us
      // is P20's sentence about the same column, and the age is P21's.
      { legacyPatientId: 'p-future', dob: '03/04/2090', rawData: '{}' },
      { legacyPatientId: 'p-ancient', dob: '05-06-1890', rawData: '{}' },

      // Left alone: one number is above 12, so only one reading parses and the
      // order is certain. That is P16's fix on the slash spelling and P17's on
      // the dash and dot ones — and both of them propose a value.
      { legacyPatientId: 'p-us-certain', dob: '02/16/1962', rawData: '{}' },
      { legacyPatientId: 'p-euro-certain', dob: '14-08-1982', rawData: '{}' },
      { legacyPatientId: 'p-dot-certain', dob: '14.08.1982', rawData: '{}' },

      // Left alone: no reading of these is a date at all, so there is nothing
      // to report that would not be invented. A zero is not a month and not a
      // day, on either side.
      { legacyPatientId: 'p-no-month', dob: '20-13-1971', rawData: '{}' },
      { legacyPatientId: 'p-both-above', dob: '13/14/1990', rawData: '{}' },
      { legacyPatientId: 'p-zero-first', dob: '00-12-1975', rawData: '{}' },
      { legacyPatientId: 'p-zero-second', dob: '03-00-1989', rawData: '{}' },

      // Left alone: a cell that changes separator half way through is none of
      // the spellings the catalogue names, here or in P16 and P17.
      { legacyPatientId: 'p-mixed-separator', dob: '03-04.1989', rawData: '{}' },

      // Left alone: a two-digit year is P19's finding, ambiguous for its own
      // reason — 89 is 1989 or 2089 and the century is not in the cell.
      { legacyPatientId: 'p-two-digit-year', dob: '03-04-89', rawData: '{}' },
      { legacyPatientId: 'p-two-digit-year-slash', dob: '03/04/89', rawData: '{}' },

      // Left alone: already ISO, which is what resolving this finding produces.
      // The first number is the four-digit year, not a one- or two-digit day.
      { legacyPatientId: 'p-iso', dob: '2000-01-22', rawData: '{}' },
      { legacyPatientId: 'p-iso-slash', dob: '2000/01/22', rawData: '{}' },

      // Left alone: not a date at all, a date with something extra stuck to it,
      // and a separator no catalogue entry names.
      { legacyPatientId: 'p-words', dob: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-with-time', dob: '03-04-1989 00:00', rawData: '{}' },
      { legacyPatientId: 'p-four-parts', dob: '03-04-19-89', rawData: '{}' },
      { legacyPatientId: 'p-space-separated', dob: '03 04 1989', rawData: '{}' },

      // Left alone: no date in the column at all, which is P22's finding.
      { legacyPatientId: 'p-blank', dob: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', dob: '', rawData: '{}' },
      { legacyPatientId: 'p-null', dob: null, rawData: '{}' },

      // Left alone: a two-way date written into another column entirely. P18
      // tests one column (1.1.5) and this row's dob is already ISO.
      {
        legacyPatientId: 'p-other-column',
        dob: '1984-07-03',
        signupDate: '03-04-1989',
        fullName: '03/04/1989',
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

  it('reports every dob whose two numbers are both 12 or under, and proposes nothing', async () => {
    const response = await p18.run(context);

    // One call, every row (1.1.14). `prev` is the cell exactly as stored —
    // padding, separator and all — because the cell as written is what the
    // human has to read to work out which of the two dates was meant. `next` is
    // null on all of them, which is what an ambiguous rule returns (1.1.12).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-ancient',
        column: 'dob',
        prev: '05-06-1890',
        // An implied age over 100 is P21's finding about the same column, and
        // no help at all in choosing between the 5th of June and the 6th of
        // May — both are over 100.
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-dash-both',
        column: 'dob',
        prev: '03-04-1989',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-dash-edge',
        column: 'dob',
        prev: '11-12-1995',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-dot-both',
        column: 'dob',
        prev: '03.04.1989',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-future',
        column: 'dob',
        prev: '03/04/2090',
        // A date in the future is P20's finding about the same column, not a
        // reason for this rule to stop asking which date this is.
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'dob',
        prev: '  05/06/1977  ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-same-number',
        column: 'dob',
        prev: '07/07/1984',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-slash-both',
        column: 'dob',
        prev: '03/04/1989',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-slash-edge',
        column: 'dob',
        prev: '12/11/1995',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-slash-ones',
        column: 'dob',
        prev: '01/01/1980',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-twelve-twelve',
        column: 'dob',
        prev: '12-12-1972',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-unpadded',
        column: 'dob',
        prev: '3-4-1989',
        next: null,
      },
    ]);
  });

  it('addresses each finding by the row it read the date from', async () => {
    const response = await p18.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `dob`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the date it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.dob).toBe(update.prev);
    }
  });

  it('reports the ambiguity whichever of the three separators the cell used', async () => {
    const response = await p18.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // The same two numbers, spelled three ways, are one finding. P16 owns the
    // slash spelling and P17 the dash and dot ones only because their
    // proposals differ by spelling; this rule proposes nothing, so it has
    // nothing to split (1.1.4).
    expect(touched).toContain('p-slash-both');
    expect(touched).toContain('p-dash-both');
    expect(touched).toContain('p-dot-both');
  });

  it('leaves every date whose order is certain, and every other cell, alone', async () => {
    const response = await p18.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // One number above 12 cannot be a month, so only one reading parses and
    // the order is certain. Those rows are P16's and P17's fixes, and they
    // propose a value — the line that lets this rule be the ambiguous half.
    expect(touched).not.toContain('p-us-certain');
    expect(touched).not.toContain('p-euro-certain');
    expect(touched).not.toContain('p-dot-certain');

    // Neither reading is a date: a number above 12 on both sides, or a zero on
    // either side. Nothing to report that would not be invented.
    expect(touched).not.toContain('p-no-month');
    expect(touched).not.toContain('p-both-above');
    expect(touched).not.toContain('p-zero-first');
    expect(touched).not.toContain('p-zero-second');

    // A cell that changes separator half way through is none of the spellings
    // the catalogue names.
    expect(touched).not.toContain('p-mixed-separator');

    // A two-digit year is P19's: the century is not in the cell.
    expect(touched).not.toContain('p-two-digit-year');
    expect(touched).not.toContain('p-two-digit-year-slash');

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
    const response = await p18.run(context);

    // The catalogue marks P18 ambiguous: both readings are real dates, the
    // export notes say both kinds of automation wrote this table and nobody
    // remembers which wrote when, and nothing else in the row settles it. The
    // flag is rule-wide (1.1.12) — stated once beside the updates — and the
    // `rule` row says the same thing the response does, which is what makes the
    // description the human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p18.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
      expect(update.prev).not.toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p18]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P18', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once a human writes the date they confirmed', async () => {
    const before = await p18.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-dash-both');

    // What resolving an ambiguous finding does: a person who can check the real
    // date of birth writes it ISO into the column the rule tested (1.1.5). An
    // ISO date leads with a four-digit year, so the rule is self-terminating
    // and the settled row does not come back.
    await patients.update({ legacyPatientId: 'p-dash-both' }, { dob: '1989-04-03' });

    const after = await p18.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-dash-both');

    await patients.update({ legacyPatientId: 'p-dash-both' }, { dob: '03-04-1989' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p18.run(context);

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

  it('is registered in the catalogue as P18 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p18);
    expect(p18.ruleId).toBe('P18');
    expect(p18.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p18.ruleName.length).toBeGreaterThan(0);
    expect(p18.description.length).toBeGreaterThan(0);
  });
});
