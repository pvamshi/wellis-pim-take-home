import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p34 } from '../src/rules/catalogue/p34';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P34 — a patient `phone` holding letters, or an extension written after the
 * number, against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 31;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

/**
 * The catalogue's test, written out again here rather than imported from the
 * rule: a letter, anywhere in the cell. A test that reused the rule's own
 * `\p{L}` would agree with it whatever it said, so this asks a different
 * question — a character that has a case is a letter, and a digit, a space, a
 * bracket, a dash and a `+` all have none. That covers every fixture below,
 * Cyrillic included; it would not recognise a caseless script, and no fixture
 * uses one.
 */
function holdsLetter(value: string): boolean {
  return [...value].some((character) => character.toLowerCase() !== character.toUpperCase());
}

describe('P34 — a patient phone holding letters or an extension', () => {
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
      // The catalogue's own two examples: an extension written after the
      // number, spelt the way the person dialling it would read it.
      { legacyPatientId: 'p-ext', phone: '06-12345678 ext 12', rawData: '{}' },
      { legacyPatientId: 'p-tst', phone: '0612345678 tst', rawData: '{}' },

      // The same thing in the words a Dutch switchboard is written with, and
      // with the number already cleaned and given its country code — an
      // extension survives every other rule on this column untouched, because
      // each of them steps over a cell with a letter in it.
      { legacyPatientId: 'p-toestel', phone: '020 1234567 toestel 3', rawData: '{}' },
      { legacyPatientId: 'p-x', phone: '+31201234567 x12', rawData: '{}' },

      // A word instead of a number: somebody writing "there isn't one" rather
      // than leaving the cell blank. There are no digits here to keep.
      { legacyPatientId: 'p-onbekend', phone: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-geen', phone: 'geen', rawData: '{}' },
      { legacyPatientId: 'p-nvt', phone: 'n.v.t.', rawData: '{}' },

      // A note about whose phone it is, left beside the number because there
      // was nowhere else to put it.
      { legacyPatientId: 'p-note', phone: '+31612345678 (werk)', rawData: '{}' },
      { legacyPatientId: 'p-mother', phone: '0612345678 moeder', rawData: '{}' },

      // A letter among the digits — a slipped key. Which digit it was typed
      // over, if any, is not in the cell.
      { legacyPatientId: 'p-slipped', phone: '06123456X8', rawData: '{}' },

      // A letter in a script that is not ASCII. The same finding, and a rule
      // reading only `[A-Za-z]` would migrate this one as a phone number.
      { legacyPatientId: 'p-cyrillic', phone: '0612345678 нет', rawData: '{}' },

      // Left alone: grouping and padding, which is P30's fix. There is no
      // letter here, and the marks between the digits are the typist's spacing.
      { legacyPatientId: 'p-grouped', phone: '06 12 34 56 78', rawData: '{}' },
      { legacyPatientId: 'p-dashed', phone: '06-12345678', rawData: '{}' },
      { legacyPatientId: 'p-brackets', phone: '+31 (0)6 12345678', rawData: '{}' },
      { legacyPatientId: 'p-padded', phone: '  0612345678  ', rawData: '{}' },

      // Left alone: the prefix rules' cells. A trunk zero is P32's fix and a
      // `00` exit prefix is P31's, and neither is a cell somebody wrote words
      // into.
      { legacyPatientId: 'p-national', phone: '0612345678', rawData: '{}' },
      { legacyPatientId: 'p-exit', phone: '0031612345678', rawData: '{}' },

      // Left alone: a number of the right shape, and two of counts no number
      // has. What the digits add up to is P33's question, not this rule's.
      { legacyPatientId: 'p-plus31', phone: '+31612345678', rawData: '{}' },
      { legacyPatientId: 'p-short', phone: '123', rawData: '{}' },
      { legacyPatientId: 'p-long', phone: '1234567890123456', rawData: '{}' },

      // Left alone: one digit repeated, which is P35's placeholder.
      { legacyPatientId: 'p-placeholder', phone: '000000000', rawData: '{}' },

      // Left alone: a trailing group of digits. Nothing in the cell says the
      // `12` is an extension rather than the last group of a number written
      // oddly or a digit typed twice, and guessing wrong deletes real digits
      // out of a real number. These are grouped digits as far as anything here
      // can tell, so they are P30's to clean and P33's to count.
      { legacyPatientId: 'p-trailing', phone: '0201234567 12', rawData: '{}' },
      { legacyPatientId: 'p-trailing-dash', phone: '0201234567-12', rawData: '{}' },

      // Left alone: a stray mark that is not a letter. A slash, a question mark
      // and a misplaced `+` are not what this catalogue entry names, and
      // reporting them here would make this rule "anything the other phone
      // rules did not want".
      { legacyPatientId: 'p-slash', phone: '06/12345678', rawData: '{}' },
      { legacyPatientId: 'p-question', phone: '0612345678?', rawData: '{}' },
      { legacyPatientId: 'p-plus-middle', phone: '06+31612345678', rawData: '{}' },

      // Left alone: nothing in the cell — absent, empty, or whitespace only.
      // None of the three holds a letter, and an empty phone is P36's finding.
      { legacyPatientId: 'p-null', phone: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', phone: '', rawData: '{}' },
      { legacyPatientId: 'p-blank', phone: '   ', rawData: '{}' },

      // Left alone: letters sitting in other columns entirely. P34 tests one
      // column and reports against that column (1.1.5), and this row's phone is
      // an ordinary number.
      {
        legacyPatientId: 'p-othercolumn',
        phone: '+31612345678',
        bsn: 'onbekend',
        fullName: 'Jan de Vries',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // phone here holds no letter.
      { legacyPatientId: ' p-paddedid ', phone: '+31612345678', rawData: '{}' },
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

  it('reports every phone with a letter in it, and nothing else', async () => {
    const response = await p34.run(context);

    // One call, every row (1.1.14). `prev` is the cell verbatim so the human
    // sees the words as they were typed, `next` is null throughout (1.1.12),
    // and `column` is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-cyrillic',
        column: 'phone',
        prev: '0612345678 нет',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-ext',
        column: 'phone',
        prev: '06-12345678 ext 12',
        next: null,
      },
      { table: 'patient', legacyId: 'p-geen', column: 'phone', prev: 'geen', next: null },
      {
        table: 'patient',
        legacyId: 'p-mother',
        column: 'phone',
        prev: '0612345678 moeder',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-note',
        column: 'phone',
        prev: '+31612345678 (werk)',
        next: null,
      },
      { table: 'patient', legacyId: 'p-nvt', column: 'phone', prev: 'n.v.t.', next: null },
      { table: 'patient', legacyId: 'p-onbekend', column: 'phone', prev: 'onbekend', next: null },
      { table: 'patient', legacyId: 'p-slipped', column: 'phone', prev: '06123456X8', next: null },
      {
        table: 'patient',
        legacyId: 'p-toestel',
        column: 'phone',
        prev: '020 1234567 toestel 3',
        next: null,
      },
      { table: 'patient', legacyId: 'p-tst', column: 'phone', prev: '0612345678 tst', next: null },
      { table: 'patient', legacyId: 'p-x', column: 'phone', prev: '+31201234567 x12', next: null },
    ]);
  });

  it('is the catalogue test — a letter anywhere in the cell', async () => {
    const response = await p34.run(context);

    // Every reported cell, measured against the test written independently of
    // the rule.
    for (const update of response.updates) {
      expect(holdsLetter(update.prev ?? '')).toBe(true);
    }

    // And the other side of it: every fixture the rule walked past holds no
    // letter at all. Nothing with words in it was missed.
    const touched = new Set(response.updates.map((update) => update.legacyId));
    const stored = await patients.find();

    for (const patient of stored) {
      if (touched.has(patient.legacyPatientId) || patient.phone === null) {
        continue;
      }

      expect(holdsLetter(patient.phone)).toBe(false);
    }
  });

  it('catches an extension however it is spelt, and a word instead of a number', async () => {
    const response = await p34.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // The catalogue names `ext 12` and `tst`; `toestel` and `x` are the same
    // thing in the words a Dutch switchboard is written with. All four are one
    // finding under one id (1.1.4), whether the number in front of the
    // extension is still grouped or has already been given its country code.
    expect(touched).toContain('p-ext');
    expect(touched).toContain('p-tst');
    expect(touched).toContain('p-toestel');
    expect(touched).toContain('p-x');

    // A word meaning there is no number, which the other phone rules all step
    // over — and which would otherwise migrate as a patient's phone number.
    expect(touched).toContain('p-onbekend');
    expect(touched).toContain('p-geen');
    expect(touched).toContain('p-nvt');

    // A letter in any script, not only ASCII.
    expect(touched).toContain('p-cyrillic');
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p34.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `phone`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.phone).toBe(update.prev);
    }
  });

  it('leaves the cells the other phone rules own alone', async () => {
    const response = await p34.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Grouping and padding are P30's fix.
    expect(touched).not.toContain('p-grouped');
    expect(touched).not.toContain('p-dashed');
    expect(touched).not.toContain('p-brackets');
    expect(touched).not.toContain('p-padded');

    // A trunk zero is P32's and a `00` exit prefix is P31's.
    expect(touched).not.toContain('p-national');
    expect(touched).not.toContain('p-exit');

    // What the digits add up to is P33's question, and a run of one digit is
    // P35's placeholder.
    expect(touched).not.toContain('p-plus31');
    expect(touched).not.toContain('p-short');
    expect(touched).not.toContain('p-long');
    expect(touched).not.toContain('p-placeholder');

    // Nothing in the column at all: absent, empty, whitespace only — P36's.
    expect(touched).not.toContain('p-null');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-blank');
  });

  it('does not read a trailing group of digits as an extension', async () => {
    const response = await p34.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Nothing in `0201234567 12` says the `12` is an extension rather than the
    // last group of a number written oddly or a digit typed twice. Reporting it
    // would be this rule guessing, and a human acting on the guess would delete
    // real digits out of a real number.
    expect(touched).not.toContain('p-trailing');
    expect(touched).not.toContain('p-trailing-dash');

    // A stray mark that is not a letter is not this catalogue entry either.
    expect(touched).not.toContain('p-slash');
    expect(touched).not.toContain('p-question');
    expect(touched).not.toContain('p-plus-middle');
  });

  it('reports against the column it tested and no other', async () => {
    const response = await p34.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Letters in `bsn` and `full_name` are those columns' rules (1.1.5), and
    // this row's phone is an ordinary number — as is the padded id's, which is
    // P01's finding and not this rule's.
    expect(touched).not.toContain('p-othercolumn');
    expect(touched).not.toContain(' p-paddedid ');

    for (const update of response.updates) {
      expect(update.column).toBe('phone');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p34.run(context);

    // The catalogue marks P34 ambiguous: an extension is a second number and
    // dropping it loses how the patient is reached, running the digits either
    // side together makes a number nobody has, and a word holds no digits at
    // all. The flag is rule-wide (1.1.12), stated once beside the updates, and
    // the `rule` row says the same thing the response does, which is what makes
    // the description the human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p34.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p34]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P34', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once the number is in the cell, or the cell is cleared', async () => {
    const before = await p34.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-ext');
    expect(before.updates.map((update) => update.legacyId)).toContain('p-onbekend');

    // What resolving an ambiguous finding does: a human writes the patient's
    // own number into the column the rule tested (1.1.5), or — where there
    // never was one — takes the text out, which is then P36's ordinary empty
    // finding rather than this one. The rule is self-terminating either way,
    // because it tests what it reports on.
    await patients.update({ legacyPatientId: 'p-ext' }, { phone: '+31201234512' });
    await patients.update({ legacyPatientId: 'p-onbekend' }, { phone: null });

    const after = await p34.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-ext');
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-onbekend');

    await patients.update({ legacyPatientId: 'p-ext' }, { phone: '06-12345678 ext 12' });
    await patients.update({ legacyPatientId: 'p-onbekend' }, { phone: 'onbekend' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p34.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — a cell quietly stripped of its extension most of all.
    expect(before).toHaveLength(FIXTURE_ROWS);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P34 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p34);
    expect(p34.ruleId).toBe('P34');
    expect(p34.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), and
    // for an ambiguous rule it is the whole explanation, since there is no
    // proposed value to show.
    expect(p34.ruleName.length).toBeGreaterThan(0);
    expect(p34.description.length).toBeGreaterThan(0);
  });
});
