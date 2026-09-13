import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p09 } from '../src/rules/catalogue/p09';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P09 — a patient `full_name` holding a single word, so no surname at all,
 * against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P09 — a patient name that is a single word', () => {
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
      // What the rule is for: one word and nothing else in the cell.
      { legacyPatientId: 'p-given-only', fullName: 'Jan', rawData: '{}' },

      // The word may be either half of the name, and nothing in the cell says
      // which. This one reads as a surname with the given name gone, and it is
      // reported in exactly the same way — which is why the rule proposes
      // nothing rather than guessing at the half that is missing.
      { legacyPatientId: 'p-surname-only', fullName: 'Berg', rawData: '{}' },

      // Case is nothing to this rule: a shouted single word is still a single
      // word, and P04 can have its own finding on the same row.
      { legacyPatientId: 'p-shouted', fullName: 'JAN', rawData: '{}' },
      { legacyPatientId: 'p-lowercase', fullName: 'jan', rawData: '{}' },

      // Padding is nothing to it either. P03 owns the padding; what is between
      // the padding is one word.
      { legacyPatientId: 'p-padded', fullName: '  Jan  ', rawData: '{}' },
      { legacyPatientId: 'p-tabbed', fullName: '\tJan\n', rawData: '{}' },

      // Nothing reaches inside a word. A hyphen joins two given names into one
      // name and an apostrophe belongs to the surname it sits in, so each of
      // these is one name part and the row still has no second one.
      { legacyPatientId: 'p-hyphenated', fullName: 'Anne-Marie', rawData: '{}' },
      { legacyPatientId: 'p-apostrophe', fullName: "O'Brien", rawData: '{}' },

      // A dot is not a separator either, so an initial glued to a surname is
      // one word here — and a row whose whole name is that is one a human is
      // right to be asked about.
      { legacyPatientId: 'p-initial-glued', fullName: 'J.Smit', rawData: '{}' },

      // A single letter, and a single word that is not a name at all: both are
      // one word, and neither says what the person is called.
      { legacyPatientId: 'p-one-letter', fullName: 'X', rawData: '{}' },
      { legacyPatientId: 'p-unknown', fullName: 'onbekend', rawData: '{}' },

      // A run of digits too short and too long to be a phone number. P07 leaves
      // both — they are outside every phone length — and its own note hands
      // them here, so this rule is where they must land.
      { legacyPatientId: 'p-short-digits', fullName: '12345', rawData: '{}' },
      { legacyPatientId: 'p-long-digits', fullName: '1234567890123456789', rawData: '{}' },

      // A comma with nothing on one side of it is a stray character, not an
      // inversion: P05 walks past it, and one word with a comma stuck to it is
      // still one word.
      { legacyPatientId: 'p-trailing-comma', fullName: 'Berg,', rawData: '{}' },
      { legacyPatientId: 'p-leading-comma', fullName: ', Jan', rawData: '{}' },

      // Left alone: an ordinary name, and every name that has two words in it
      // however wrong they are — P03's spacing, P04's case, P05's inversion,
      // P06's salutation. Each is its own rule and its own approval.
      { legacyPatientId: 'p-plain', fullName: 'Jan de Vries', rawData: '{}' },
      { legacyPatientId: 'p-two-words', fullName: 'Jan Vries', rawData: '{}' },
      { legacyPatientId: 'p-padded-two', fullName: '  Jan  de Vries ', rawData: '{}' },
      { legacyPatientId: 'p-shouted-two', fullName: 'JAN DE VRIES', rawData: '{}' },
      { legacyPatientId: 'p-inverted', fullName: 'Berg, Jan van der', rawData: '{}' },
      { legacyPatientId: 'p-title', fullName: 'Dhr. Jan de Vries', rawData: '{}' },

      // Left alone: a title in front of a lone given name. It is two words
      // today and P06 owns it — when the salutation comes off, the row is one
      // word and comes back here.
      { legacyPatientId: 'p-title-single', fullName: 'Dhr. Jan', rawData: '{}' },

      // Left alone: comma-inverted with no space after the comma. Both halves
      // of the name are in the cell, and P05 is already putting them in
      // reading order — saying "no surname" about it would be saying it about
      // a row whose surname is the first thing in it.
      { legacyPatientId: 'p-inverted-tight', fullName: 'Berg,Jan', rawData: '{}' },

      // Left alone: contact detail filling the cell is P07's finding. There is
      // no name in these at all, so there is no missing half of one.
      { legacyPatientId: 'p-email', fullName: 'jan.devries@gmail.com', rawData: '{}' },
      { legacyPatientId: 'p-email-padded', fullName: '  zeynep.chen@live.nl  ', rawData: '{}' },
      { legacyPatientId: 'p-email-no-dot', fullName: 'noemail@x', rawData: '{}' },
      { legacyPatientId: 'p-phone', fullName: '06-53549409', rawData: '{}' },
      { legacyPatientId: 'p-phone-dots', fullName: '06.5354.9409', rawData: '{}' },
      { legacyPatientId: 'p-phone-zeros', fullName: '0031653549409', rawData: '{}' },

      // Left alone: an absent name is P08's finding. Zero words is not one.
      { legacyPatientId: 'p-null', fullName: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', fullName: '', rawData: '{}' },
      { legacyPatientId: 'p-spaces', fullName: '   ', rawData: '{}' },
      { legacyPatientId: 'p-comma-only', fullName: ' , ', rawData: '{}' },

      // Left alone: a single word in another column. This rule tests one column
      // (1.1.5) and this row's name is a whole name.
      {
        legacyPatientId: 'p-other-column',
        fullName: 'Piet Jansen',
        email: 'piet',
        city: 'Delft',
        source: 'import',
        rawData: '{}',
      },

      // Reported, and the id is reported exactly as the row holds it: padding
      // on the id is P01's fix, and it does not stop this rule saying that this
      // row has half a name.
      { legacyPatientId: ' p-padded-id ', fullName: 'Sanne', rawData: '{}' },
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

  it('reports every name that is a single word', async () => {
    const response = await p09.run(context);

    // One call, every row (1.1.14). `column` is the column that was tested
    // (1.1.5), `prev` is what it held verbatim — padding and punctuation and
    // all, so the human reads the real cell — and `next` is null on all of
    // them because there is nothing to propose.
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: ' p-padded-id ',
        column: 'full_name',
        prev: 'Sanne',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-apostrophe',
        column: 'full_name',
        prev: "O'Brien",
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-given-only',
        column: 'full_name',
        prev: 'Jan',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-hyphenated',
        column: 'full_name',
        prev: 'Anne-Marie',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-initial-glued',
        column: 'full_name',
        prev: 'J.Smit',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-leading-comma',
        column: 'full_name',
        prev: ', Jan',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-long-digits',
        column: 'full_name',
        prev: '1234567890123456789',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-lowercase',
        column: 'full_name',
        prev: 'jan',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-one-letter',
        column: 'full_name',
        prev: 'X',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'full_name',
        prev: '  Jan  ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-short-digits',
        column: 'full_name',
        prev: '12345',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-shouted',
        column: 'full_name',
        prev: 'JAN',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-surname-only',
        column: 'full_name',
        prev: 'Berg',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-tabbed',
        column: 'full_name',
        prev: '\tJan\n',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-trailing-comma',
        column: 'full_name',
        prev: 'Berg,',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-unknown',
        column: 'full_name',
        prev: 'onbekend',
        next: null,
      },
    ]);
  });

  it('addresses each finding by the row it read the name from', async () => {
    const response = await p09.run(context);

    // `legacyId` is how the persistence layer addresses the finding (1.1.3).
    // This rule tests `full_name`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.fullName).toBe(update.prev);
    }
  });

  it('leaves a name with two words in it alone, however else it is wrong', async () => {
    const response = await p09.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A name with both halves in it is not this rule's finding, whatever else
    // P03, P04, P05 or P06 has to say about it (1.1.4).
    expect(touched).not.toContain('p-plain');
    expect(touched).not.toContain('p-two-words');
    expect(touched).not.toContain('p-padded-two');
    expect(touched).not.toContain('p-shouted-two');
    expect(touched).not.toContain('p-inverted');
    expect(touched).not.toContain('p-title');

    // A salutation in front of a lone given name is two words today, and the
    // one that comes off is P06's fix and P06's approval.
    expect(touched).not.toContain('p-title-single');

    // A comma-inverted name with no space after the comma holds both halves,
    // and P05 is the rule that puts them in reading order.
    expect(touched).not.toContain('p-inverted-tight');

    // And no other column is reported against, however short a word it holds
    // (1.1.5).
    expect(touched).not.toContain('p-other-column');
    for (const update of response.updates) {
      expect(update.column).toBe('full_name');
      expect(update.table).toBe('patient');
    }
  });

  it('leaves the cells that hold no name at all to P07 and P08', async () => {
    const response = await p09.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // An address or a number filling the cell is P07's finding: the cell holds
    // no name, so it holds no half of one, and "there is no surname here" would
    // tell a human there is a given name in a cell that has none.
    expect(touched).not.toContain('p-email');
    expect(touched).not.toContain('p-email-padded');
    expect(touched).not.toContain('p-email-no-dot');
    expect(touched).not.toContain('p-phone');
    expect(touched).not.toContain('p-phone-dots');
    expect(touched).not.toContain('p-phone-zeros');

    // A run of digits outside every phone length is not contact detail to P07,
    // and P07's own note hands it here — so it is reported, and the two rules
    // leave no digit blob with no rule at all.
    expect(touched).toContain('p-short-digits');
    expect(touched).toContain('p-long-digits');

    // An absent, empty or whitespace-only name is P08's finding. Zero words is
    // not one word, and a cell holding only a comma has no word in it either.
    expect(touched).not.toContain('p-null');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-spaces');
    expect(touched).not.toContain('p-comma-only');
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p09.run(context);

    // The catalogue marks P09 ambiguous: the missing half of the name is not
    // in the row, and the cell does not even say which half is present, so
    // there is nothing to propose. The flag is rule-wide (1.1.12) — stated
    // once beside the updates — and the `rule` row says the same thing the
    // response does, which is what makes the description the human's only
    // explanation.
    expect(response.ambiguity).toBe(true);
    expect(p09.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p09]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P09', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p09.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — a half name quietly completed most of all.
    expect(before).toHaveLength(35);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P09 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p09);
    expect(p09.ruleId).toBe('P09');
    expect(p09.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p09.ruleName.length).toBeGreaterThan(0);
    expect(p09.description.length).toBeGreaterThan(0);
  });
});
