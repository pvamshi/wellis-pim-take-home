import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p22 } from '../src/rules/catalogue/p22';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P22 — a patient row with no `dob` at all, against a real database with real
 * rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 20;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P22 — a patient date of birth that is empty', () => {
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
      // What the rule is for, in all three ways a cell arrives with no date in
      // it: the column absent, the cell empty, and the cell typed into with
      // nothing but spacing. The whitespace ones are this rule's because every
      // other rule in the column reads the trimmed cell, finds no date there,
      // and walks past.
      { legacyPatientId: 'p-null', dob: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', dob: '', rawData: '{}' },
      { legacyPatientId: 'p-spaces', dob: '   ', rawData: '{}' },
      { legacyPatientId: 'p-tab', dob: '\t', rawData: '{}' },
      { legacyPatientId: 'p-newline', dob: '\n ', rawData: '{}' },

      // Reported too, and reported anyway: the rest of the row is complete and
      // none of it dates this person's birth. This is the row that proves the
      // rule does not construct a date of birth out of a signup date, a name or
      // a citizen service number — an invented birthday decides the age gate
      // and the duplicate match on a guess.
      {
        legacyPatientId: 'p-empty-with-details',
        dob: '',
        fullName: 'Jan de Vries',
        email: 'jan.devries@gmail.com',
        bsn: '251508596',
        phone: '06-53549409',
        city: 'Utrecht',
        signupDate: '2023-03-21',
        rawData: '{}',
      },

      // Left alone: a date the column is supposed to hold.
      { legacyPatientId: 'p-iso', dob: '2000-01-22', rawData: '{}' },

      // Left alone: padding around a real date. The cell holds a date; it is
      // untidy, not absent, and the ISO value P16 and P17 propose is the fix
      // for how it is written.
      { legacyPatientId: 'p-padded-date', dob: '  2000-01-22  ', rawData: '{}' },

      // Left alone: US-style with a certain order, which is P16's fix, and the
      // two European spellings, which are P17's.
      { legacyPatientId: 'p-us-style', dob: '02/16/1962', rawData: '{}' },
      { legacyPatientId: 'p-euro-dash', dob: '14-08-1982', rawData: '{}' },
      { legacyPatientId: 'p-euro-dot', dob: '14.08.1982', rawData: '{}' },

      // Left alone: a date that reads two ways (P18), a two-digit year (P19), a
      // date in the future (P20) and an implausible age (P21). Every one of
      // them has a date in it, which is the thing this row does not.
      { legacyPatientId: 'p-two-way', dob: '03/04/1972', rawData: '{}' },
      { legacyPatientId: 'p-short-year', dob: '03-04-54', rawData: '{}' },
      { legacyPatientId: 'p-future', dob: '2059-01-05', rawData: '{}' },
      { legacyPatientId: 'p-young', dob: '2009-02-15', rawData: '{}' },

      // Left alone: a cell with a word or a mark in it. The catalogue's P22 is
      // the empty cell, and none of these is empty. The `dob` section names no
      // rule for a date of birth that is not a date at all, and this rule does
      // not adopt one (1.1.4).
      { legacyPatientId: 'p-word', dob: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-dash', dob: '-', rawData: '{}' },
      { legacyPatientId: 'p-no-such-day', dob: '13/25/1990', rawData: '{}' },

      // Left alone: emptiness in every other column. P08 owns an empty
      // `full_name`, P15 an empty `email`, P36 an empty `phone`, P40 an empty
      // `city` and P63 an empty `signup_date` — this rule tests one column
      // (1.1.5) and this row's date of birth is a date.
      {
        legacyPatientId: 'p-other-column-empty',
        dob: '1978-04-02',
        fullName: '',
        email: '   ',
        phone: '',
        city: null,
        signupDate: '',
        rawData: '{}',
      },

      // Reported, and the id is reported exactly as the row holds it: padding
      // on the id is P01's fix and an empty id is P02's finding, and neither
      // stops this rule from saying that this row has no date of birth.
      { legacyPatientId: ' p-padded-id ', dob: '', rawData: '{}' },
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

  it('reports every row whose date of birth is absent, empty or nothing but whitespace', async () => {
    const response = await p22.run(context);

    // One call, every row (1.1.14). `column` is the column that was tested
    // (1.1.5), `prev` is what it held verbatim — so `null`, `''` and `'   '`
    // stay three distinguishable things to the human reading the row — and
    // `next` is null on all of them because there is nothing to propose.
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: ' p-padded-id ',
        column: 'dob',
        prev: '',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-empty',
        column: 'dob',
        prev: '',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-empty-with-details',
        column: 'dob',
        prev: '',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-newline',
        column: 'dob',
        prev: '\n ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-null',
        column: 'dob',
        prev: null,
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-spaces',
        column: 'dob',
        prev: '   ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-tab',
        column: 'dob',
        prev: '\t',
        next: null,
      },
    ]);
  });

  it('addresses each finding by the row it read the date of birth from', async () => {
    const response = await p22.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `dob`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.dob).toBe(update.prev);
    }
  });

  it('reports a row that carries every other detail but a date of birth', async () => {
    const response = await p22.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A name, an email address, a citizen service number, a phone number, a
    // city and a signup date, and not one of them says when this person was
    // born. The row is reported and nothing is proposed — a signup date records
    // when the row was created, and deriving a birthday from it would invent
    // the value the age check and the duplicate match are both decided on.
    expect(touched).toContain('p-empty-with-details');

    const finding = response.updates.find((update) => update.legacyId === 'p-empty-with-details');
    expect(finding?.next).toBeNull();
  });

  it('leaves a cell with something in it alone, however wrong that something is', async () => {
    const response = await p22.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A real date is what the column is supposed to hold, and padding around
    // one does not make the cell empty.
    expect(touched).not.toContain('p-iso');
    expect(touched).not.toContain('p-padded-date');

    // Spellings that are somebody else's fix: US-style with a certain order is
    // P16's, the two European forms are P17's (1.1.4).
    expect(touched).not.toContain('p-us-style');
    expect(touched).not.toContain('p-euro-dash');
    expect(touched).not.toContain('p-euro-dot');

    // Findings that are somebody else's question about a date that is there: a
    // two-way reading is P18's, a two-digit year P19's, a future date P20's, an
    // implausible age P21's.
    expect(touched).not.toContain('p-two-way');
    expect(touched).not.toContain('p-short-year');
    expect(touched).not.toContain('p-future');
    expect(touched).not.toContain('p-young');

    // A word or a mark in the column is not an empty column. The catalogue
    // names no rule for a `dob` that is not a date at all, and this rule is the
    // empty cell rather than a wider one wearing its id.
    expect(touched).not.toContain('p-word');
    expect(touched).not.toContain('p-dash');
    expect(touched).not.toContain('p-no-such-day');
  });

  it('reads and reports one column, however empty the rest of the row is', async () => {
    const response = await p22.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // An empty `full_name`, `email`, `phone`, `city` and `signup_date` on one
    // row, and none of them this rule's: it tests `dob` and reports against
    // `dob` (1.1.5).
    expect(touched).not.toContain('p-other-column-empty');

    for (const update of response.updates) {
      expect(update.column).toBe('dob');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p22.run(context);

    // The catalogue marks P22 ambiguous: a date of birth is not derivable from
    // a name, an email address, a citizen service number or a signup date, so
    // there is nothing to propose. The flag is rule-wide (1.1.12) — stated once
    // beside the updates — and the `rule` row says the same thing the response
    // does, which is what makes the description the human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p22.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p22]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P22', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once a date is in the cell', async () => {
    const before = await p22.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-spaces');

    // What resolving an ambiguous finding does: a human looks the date of birth
    // up and writes it into the column the rule tested (1.1.5). The rule is
    // self-terminating — it tests what it reports on, so the row does not come
    // back.
    await patients.update({ legacyPatientId: 'p-spaces' }, { dob: '1968-06-11' });

    const after = await p22.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-spaces');

    await patients.update({ legacyPatientId: 'p-spaces' }, { dob: '   ' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p22.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — an empty date of birth quietly filled in most of all.
    expect(before).toHaveLength(FIXTURE_ROWS);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P22 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p22);
    expect(p22.ruleId).toBe('P22');
    expect(p22.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p22.ruleName.length).toBeGreaterThan(0);
    expect(p22.description.length).toBeGreaterThan(0);
  });
});
