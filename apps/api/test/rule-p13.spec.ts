import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p13 } from '../src/rules/catalogue/p13';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P13 — a patient `email` holding two or more addresses in one cell, against a
 * real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 29;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P13 — a patient email holding more than one address', () => {
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
      // What the rule is for: two addresses in one cell, one for each separator
      // the catalogue names — a semicolon, a slash and a comma — and a spaced
      // list, which is how a person types one.
      {
        legacyPatientId: 'p-semicolon',
        email: 'eva.smit@gmial.com;eva.smit@live.nl',
        rawData: '{}',
      },
      {
        legacyPatientId: 'p-slash',
        email: 'jan.devries@gmail.com/jan@work.nl',
        rawData: '{}',
      },
      {
        legacyPatientId: 'p-comma',
        email: 'sanne.bakker@yahoo.com, sanne@zorggroep-noord.nl',
        rawData: '{}',
      },
      {
        legacyPatientId: 'p-spaced-semicolon',
        email: 'kees@live.nl ; kees.dejong@ziggo.nl',
        rawData: '{}',
      },

      // Three of them, mixing separators. "Two or more" is what the catalogue
      // says, and the question is the same one however many there are.
      {
        legacyPatientId: 'p-three',
        email: 'a.one@live.nl;b.two@gmail.com/c.three@ziggo.nl',
        rawData: '{}',
      },

      // A trailing separator with two real addresses in front of it. The empty
      // piece is dropped, and what is left is still two addresses.
      {
        legacyPatientId: 'p-trailing-separator-pair',
        email: 'jan@gmail.com;eva@live.nl;',
        rawData: '{}',
      },

      // The same address twice. The cell still holds two addresses and still
      // delivers to nobody; the rule proposes nothing here either, because
      // ambiguity is rule-wide (1.1.12) and a human deletes the repetition in a
      // second — which they cannot do if no rule shows them the row.
      { legacyPatientId: 'p-repeated', email: 'eva@live.nl;eva@live.nl', rawData: '{}' },

      // Padding around the pair. The test is made against the trimmed value,
      // but `prev` reports the cell exactly as it is stored.
      {
        legacyPatientId: 'p-padded-pair',
        email: '  jan@gmail.com; eva@live.nl  ',
        rawData: '{}',
      },

      // Two addresses that are each also some other rule's problem: capitals
      // (P10's fix) and a misspelt provider (P11's). Neither of those rules
      // touches a cell holding two addresses, so this is the only rule that
      // reports these rows.
      {
        legacyPatientId: 'p-shouted-pair',
        email: 'JAN@GMAIL.COM;jan.jones@live.nl',
        rawData: '{}',
      },
      {
        legacyPatientId: 'p-misspelt-pair',
        email: 'mei.mulder@gmial.com,mei.mulder@live.nl',
        rawData: '{}',
      },

      // Two addresses a narrower shape test would misread: a non-ASCII domain
      // and a plus in the local part. Both are real addresses, so both cells
      // are pairs.
      { legacyPatientId: 'p-unicode-pair', email: 'jan@müller.de,jan@live.nl', rawData: '{}' },
      {
        legacyPatientId: 'p-plus-pair',
        email: 'jan_smit+news@mail.example.org/jan.smit@live.nl',
        rawData: '{}',
      },

      // Left alone: one address, which is what the column is supposed to hold.
      { legacyPatientId: 'p-single', email: 'marco.dekker@gmail.com', rawData: '{}' },

      // Left alone: a single address with a stray separator on the end. The
      // empty piece is dropped rather than counted as a second address, so this
      // is one address with something wrong with it — P12's finding.
      { legacyPatientId: 'p-single-trailing-comma', email: 'jan@gmail.com,', rawData: '{}' },

      // Left alone: a separator with something that is not an address on the
      // other side of it. An address and a note, an address and a phone number,
      // an address and a half of one. None of those is two addresses, and
      // saying "choose which of these is primary" about them would be false.
      { legacyPatientId: 'p-address-and-note', email: 'jan@gmail.com, geen', rawData: '{}' },
      {
        legacyPatientId: 'p-address-and-phone',
        email: 'jan@gmail.com/06-53549409',
        rawData: '{}',
      },
      { legacyPatientId: 'p-broken-half', email: 'jan@gmail;eva@live.nl', rawData: '{}' },

      // Left alone: two addresses run together by a space alone. The catalogue
      // names three separators and this rule builds exactly those; the cell is
      // not lost, because P12 reports it as a value that is not an address.
      { legacyPatientId: 'p-space-separated', email: 'jan@gmail.com eva@live.nl', rawData: '{}' },

      // Left alone: not an address at all, with or without a gap in it. P12's.
      { legacyPatientId: 'p-not-address', email: 'n.v.t.', rawData: '{}' },
      { legacyPatientId: 'p-inner-space', email: 'willem.ricci @icloud.com', rawData: '{}' },

      // Left alone: one address with padding, capitals or a misspelt provider.
      // Each of those rules proposes a value, and this rule has none to propose
      // — reporting the cell here as well would ask a human a question nobody
      // has (1.1.4).
      { legacyPatientId: 'p-padded-single', email: '  eva.smit@gmail.com  ', rawData: '{}' },
      { legacyPatientId: 'p-shouted-single', email: 'JAN.JONES@LIVE.NL', rawData: '{}' },
      { legacyPatientId: 'p-misspelt-single', email: 'mei.mulder@gmial.com', rawData: '{}' },

      // Left alone: a placeholder is one address, whatever it means. P14's.
      { legacyPatientId: 'p-placeholder', email: 'test@test.com', rawData: '{}' },

      // Left alone: no value at all, which is P15's finding — an absent address
      // is not two of them.
      { legacyPatientId: 'p-blank', email: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', email: '', rawData: '{}' },
      { legacyPatientId: 'p-null', email: null, rawData: '{}' },

      // Left alone: separators all over the rest of the row. This rule tests
      // one column (1.1.5) and this row's email is a single address.
      {
        legacyPatientId: 'p-other-column',
        email: 'piet.jansen@gmail.com',
        fullName: 'Jan/Eva de Vries',
        phone: '06-12345678;06-87654321',
        city: 'Delft/Rotterdam',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // address here is one address.
      { legacyPatientId: ' p-padded-id ', email: 'sanne.bakker2@yahoo.com', rawData: '{}' },
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

  it('reports every cell holding two or more addresses', async () => {
    const response = await p13.run(context);

    // One call, every row (1.1.14). `column` is the column that was tested
    // (1.1.5), `prev` is the cell verbatim, and `next` is null throughout
    // because the rule is ambiguous (1.1.12).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-comma',
        column: 'email',
        prev: 'sanne.bakker@yahoo.com, sanne@zorggroep-noord.nl',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-misspelt-pair',
        column: 'email',
        prev: 'mei.mulder@gmial.com,mei.mulder@live.nl',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-padded-pair',
        column: 'email',
        // The padding is reported with the value, not trimmed out of it: the
        // human reads what is really in the column.
        prev: '  jan@gmail.com; eva@live.nl  ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-plus-pair',
        column: 'email',
        prev: 'jan_smit+news@mail.example.org/jan.smit@live.nl',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-repeated',
        column: 'email',
        prev: 'eva@live.nl;eva@live.nl',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-semicolon',
        column: 'email',
        prev: 'eva.smit@gmial.com;eva.smit@live.nl',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-shouted-pair',
        column: 'email',
        prev: 'JAN@GMAIL.COM;jan.jones@live.nl',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-slash',
        column: 'email',
        prev: 'jan.devries@gmail.com/jan@work.nl',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-spaced-semicolon',
        column: 'email',
        prev: 'kees@live.nl ; kees.dejong@ziggo.nl',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-three',
        column: 'email',
        prev: 'a.one@live.nl;b.two@gmail.com/c.three@ziggo.nl',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-trailing-separator-pair',
        column: 'email',
        prev: 'jan@gmail.com;eva@live.nl;',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-unicode-pair',
        column: 'email',
        prev: 'jan@müller.de,jan@live.nl',
        next: null,
      },
    ]);
  });

  it('addresses each finding by the row it read the email from', async () => {
    const response = await p13.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `email`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.email).toBe(update.prev);
    }
  });

  it('leaves one address alone, however else that address is wrong', async () => {
    const response = await p13.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A single address is what the column is supposed to hold, so this rule has
    // no question to ask about it.
    expect(touched).not.toContain('p-single');

    // Padding, capitals and a misspelt provider are P10's and P11's, and a
    // placeholder is P14's. Each of those cells holds one address and each of
    // those rules proposes a value this one cannot (1.1.4).
    expect(touched).not.toContain('p-padded-single');
    expect(touched).not.toContain('p-shouted-single');
    expect(touched).not.toContain('p-misspelt-single');
    expect(touched).not.toContain('p-placeholder');

    // Nothing at all in the column. An absent address is not two addresses, and
    // P15 already asks the human for it.
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');
  });

  it('leaves a cell that is not two addresses to P12', async () => {
    const response = await p13.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A separator with something that is not an address on the other side of
    // it. Each of these is a cell that is not an address — P12's sentence — and
    // "choose which of these is primary" would be false about all three.
    expect(touched).not.toContain('p-address-and-note');
    expect(touched).not.toContain('p-address-and-phone');
    expect(touched).not.toContain('p-broken-half');

    // A stray separator on the end of one address. The empty piece is dropped
    // rather than counted, so this is one address and not two.
    expect(touched).not.toContain('p-single-trailing-comma');

    // Two addresses run together by a space alone. The catalogue names a slash,
    // a semicolon and a comma, and this rule is exactly that wide; P12 reports
    // the cell, so nothing falls through the gap.
    expect(touched).not.toContain('p-space-separated');

    // Not an address at all, with or without a gap in it.
    expect(touched).not.toContain('p-not-address');
    expect(touched).not.toContain('p-inner-space');
  });

  it('reads and reports one column, whatever the rest of the row holds', async () => {
    const response = await p13.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A slash in the name, a semicolon in the phone and a slash in the city are
    // not this rule's business: it tests `email` and reports against `email`
    // (1.1.5). The padded legacy id is P01's for the same reason.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');

    for (const update of response.updates) {
      expect(update.column).toBe('email');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p13.run(context);

    // The catalogue marks P13 ambiguous: which of the addresses is the primary
    // one is a human call, and the export does not record it. The flag is
    // rule-wide (1.1.12) — stated once beside the updates — and the `rule` row
    // says the same thing the response does, which is what makes the
    // description the human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p13.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
      expect(update.prev).not.toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p13]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P13', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once one address is left in the cell', async () => {
    const before = await p13.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-semicolon');

    // What resolving an ambiguous finding does: a human chooses one of the
    // addresses and puts it in the column the rule tested (1.1.5). The rule is
    // self-terminating — it tests what it reports on, so the row does not come
    // back.
    await patients.update({ legacyPatientId: 'p-semicolon' }, { email: 'eva.smit@live.nl' });

    const after = await p13.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-semicolon');

    await patients.update(
      { legacyPatientId: 'p-semicolon' },
      { email: 'eva.smit@gmial.com;eva.smit@live.nl' },
    );
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p13.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — a cell quietly reduced to one of its two addresses most of all.
    expect(before).toHaveLength(FIXTURE_ROWS);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P13 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p13);
    expect(p13.ruleId).toBe('P13');
    expect(p13.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p13.ruleName.length).toBeGreaterThan(0);
    expect(p13.description.length).toBeGreaterThan(0);
  });
});
