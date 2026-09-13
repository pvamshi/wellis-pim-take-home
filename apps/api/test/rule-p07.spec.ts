import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p07 } from '../src/rules/catalogue/p07';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P07 — a patient `full_name` holding an email address or a phone number
 * instead of a name, against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P07 — a patient name that is an email address or a phone number', () => {
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
      // What the rule is for, first half: the name box holding an address.
      { legacyPatientId: 'p-email-plain', fullName: 'jan.devries@gmail.com', rawData: '{}' },

      // Case is nothing to this rule: a shouted address is still an address,
      // and P04 can have its own finding on the same row.
      { legacyPatientId: 'p-email-shouted', fullName: 'JAN@LIVE.NL', rawData: '{}' },

      // Padding is nothing to it either. P03 owns the padding; what is between
      // the padding is not a name.
      { legacyPatientId: 'p-email-padded', fullName: '  zeynep.chen@live.nl  ', rawData: '{}' },

      // The `+` tag people put in a local part.
      { legacyPatientId: 'p-email-plus', fullName: 'j.smit+wellis@outlook.com', rawData: '{}' },

      // A malformed address is still contact detail in the name box. No dot is
      // demanded in the domain, so the broken ones are reported too.
      { legacyPatientId: 'p-email-no-dot', fullName: 'noemail@x', rawData: '{}' },

      // What the rule is for, second half: the name box holding a number, in
      // each of the ways a Dutch number gets written.
      { legacyPatientId: 'p-phone-dutch', fullName: '06-53549409', rawData: '{}' },
      { legacyPatientId: 'p-phone-international', fullName: '+31 6 5354 9409', rawData: '{}' },
      { legacyPatientId: 'p-phone-brackets', fullName: '(06) 5354 9409', rawData: '{}' },
      { legacyPatientId: 'p-phone-zeros', fullName: '0031653549409', rawData: '{}' },
      { legacyPatientId: 'p-phone-dots', fullName: '06.5354.9409', rawData: '{}' },

      // Left alone: an ordinary name, and the names the other `full_name` rules
      // own. Each is wrong in its own way and none of them is contact detail.
      { legacyPatientId: 'p-plain', fullName: 'Jan de Vries', rawData: '{}' },
      { legacyPatientId: 'p-inverted', fullName: 'Berg, Jan van der', rawData: '{}' },
      { legacyPatientId: 'p-title', fullName: 'Dhr. Jan de Vries', rawData: '{}' },
      { legacyPatientId: 'p-shouted', fullName: 'JAN DE VRIES', rawData: '{}' },
      { legacyPatientId: 'p-padded', fullName: '  Jan  de Vries ', rawData: '{}' },

      // Left alone: one token and no surname is P09's finding, not this one.
      { legacyPatientId: 'p-single', fullName: 'Jan', rawData: '{}' },

      // Left alone: the catalogue says "instead of a name". These rows have a
      // name in them, with contact detail alongside it, which is a different
      // question from the one this rule asks. Every way the two get written
      // into one cell is here — angle brackets, the address after the name,
      // the address before it, and the same shape for a number — because a
      // rule that says "nothing in this row says what the person is called"
      // must not say it about a row that plainly does.
      { legacyPatientId: 'p-name-with-email', fullName: 'Jan de Vries <jan@x.nl>', rawData: '{}' },
      { legacyPatientId: 'p-name-email-bare', fullName: 'Jan de Vries jan@x.nl', rawData: '{}' },
      { legacyPatientId: 'p-name-email-first', fullName: 'jan@x.nl Jan de Vries', rawData: '{}' },
      { legacyPatientId: 'p-name-with-phone', fullName: 'Jan de Vries 06-53549409', rawData: '{}' },

      // Left alone: an `@` between two words is not an address. This one is a
      // person and where they work, and it is the value that would be read as
      // contact detail by any test that squeezed the spaces out of a cell
      // before looking at it.
      { legacyPatientId: 'p-name-at-place', fullName: 'Jan @ Wellis', rawData: '{}' },

      // Left alone: an address with a stray space typed into it. The space
      // could be closed up and the value read as an address — but only by the
      // same step that turns the four rows above into addresses too, and those
      // rows matter more. This is the cost of that choice, written down.
      { legacyPatientId: 'p-email-spaced', fullName: 'jan .vries@ gmail.com', rawData: '{}' },

      // Left alone: a run of digits is only a phone number between seven and
      // fifteen of them. Five is too few to call anyone and nineteen is past
      // E.164's limit, so neither is the thing this rule reports.
      { legacyPatientId: 'p-short-digits', fullName: '12345', rawData: '{}' },
      { legacyPatientId: 'p-long-digits', fullName: '1234567890123456789', rawData: '{}' },

      // Left alone: an absent name is P08's finding, not this rule's.
      { legacyPatientId: 'p-empty', fullName: '', rawData: '{}' },
      { legacyPatientId: 'p-blank', fullName: '   ', rawData: '{}' },
      { legacyPatientId: 'p-null', fullName: null, rawData: '{}' },

      // Left alone: contact detail in the columns it belongs in. P07 tests one
      // column (1.1.5) and this row's name is a name.
      {
        legacyPatientId: 'p-other-column',
        fullName: 'Piet Jansen',
        email: 'piet@example.com',
        phone: '06-53549409',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's.
      { legacyPatientId: ' p-padded-id ', fullName: 'Sanne Bakker', rawData: '{}' },
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

  it('reports every name that is an email address or a phone number', async () => {
    const response = await p07.run(context);

    // One call, every row (1.1.14). `column` is the column that was tested
    // (1.1.5), `prev` is what it held verbatim — punctuation, padding and all,
    // so the human reads the real cell — and `next` is null on all of them
    // because there is nothing to propose.
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-email-no-dot',
        column: 'full_name',
        prev: 'noemail@x',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-email-padded',
        column: 'full_name',
        prev: '  zeynep.chen@live.nl  ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-email-plain',
        column: 'full_name',
        prev: 'jan.devries@gmail.com',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-email-plus',
        column: 'full_name',
        prev: 'j.smit+wellis@outlook.com',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-email-shouted',
        column: 'full_name',
        prev: 'JAN@LIVE.NL',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-phone-brackets',
        column: 'full_name',
        prev: '(06) 5354 9409',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-phone-dots',
        column: 'full_name',
        prev: '06.5354.9409',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-phone-dutch',
        column: 'full_name',
        prev: '06-53549409',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-phone-international',
        column: 'full_name',
        prev: '+31 6 5354 9409',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-phone-zeros',
        column: 'full_name',
        prev: '0031653549409',
        next: null,
      },
    ]);
  });

  it('addresses each finding by the row it read the name from', async () => {
    const response = await p07.run(context);

    // `legacyId` is how the persistence layer addresses the finding (1.1.3).
    // This rule tests `full_name`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.fullName).toBe(update.prev);
    }
  });

  it('leaves a name alone, however else it is wrong', async () => {
    const response = await p07.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // An ordinary name, and the names that belong to P03, P04, P05, P06 and
    // P09, are all names. None of them is contact detail and none is reported
    // here (1.1.4).
    expect(touched).not.toContain('p-plain');
    expect(touched).not.toContain('p-inverted');
    expect(touched).not.toContain('p-title');
    expect(touched).not.toContain('p-shouted');
    expect(touched).not.toContain('p-padded');
    expect(touched).not.toContain('p-single');

    // A name with contact detail beside it still has a name in it, so it is not
    // the "instead of a name" the catalogue describes. However the two are
    // written into the one cell: brackets or no brackets, address first or name
    // first, address or number.
    expect(touched).not.toContain('p-name-with-email');
    expect(touched).not.toContain('p-name-email-bare');
    expect(touched).not.toContain('p-name-email-first');
    expect(touched).not.toContain('p-name-with-phone');

    // An `@` sitting between two words is not one either.
    expect(touched).not.toContain('p-name-at-place');

    // And neither is an address with a space typed into the middle of it,
    // which is what it costs to leave the five rows above alone.
    expect(touched).not.toContain('p-email-spaced');

    // And a run of digits outside the length any phone number has is not a
    // phone number.
    expect(touched).not.toContain('p-short-digits');
    expect(touched).not.toContain('p-long-digits');

    // An absent name is P08's finding.
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-null');

    // And no other column is reported against, whatever contact detail it holds
    // (1.1.5) — including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('full_name');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p07.run(context);

    // The catalogue marks P07 ambiguous: a name cannot be computed from an
    // email address or a phone number, so there is nothing to propose. The flag
    // is rule-wide (1.1.12) — stated once beside the updates — and the `rule`
    // row says the same thing the response does, which is what makes the
    // description the human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p07.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p07]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P07', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p07.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(29);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P07 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p07);
    expect(p07.ruleId).toBe('P07');
    expect(p07.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p07.ruleName.length).toBeGreaterThan(0);
    expect(p07.description.length).toBeGreaterThan(0);
  });
});
