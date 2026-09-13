import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p12 } from '../src/rules/catalogue/p12';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P12 — a patient `email` holding something that is not an email address,
 * against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P12 — a patient email that is not an email address', () => {
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
      // What the rule is for, first half: no `@` anywhere, so there is no
      // address in the cell and no half of one either. A note, a dash, a single
      // letter, a Dutch "not applicable", a phone number in the wrong box.
      { legacyPatientId: 'p-nvt', email: 'n.v.t.', rawData: '{}' },
      { legacyPatientId: 'p-geen', email: 'geen', rawData: '{}' },
      { legacyPatientId: 'p-dash', email: '-', rawData: '{}' },
      { legacyPatientId: 'p-single-x', email: 'x', rawData: '{}' },
      { legacyPatientId: 'p-onbekend', email: 'Onbekend', rawData: '{}' },
      { legacyPatientId: 'p-phone', email: '06-53549409', rawData: '{}' },
      { legacyPatientId: 'p-phone-spaced', email: '06 53 54 94 09', rawData: '{}' },

      // The second half: there is an `@`, and it is still not an address. A gap
      // inside it, two `@`, nothing on one side, and a link rather than an
      // address.
      { legacyPatientId: 'p-inner-space', email: 'willem.ricci @icloud.com', rawData: '{}' },
      { legacyPatientId: 'p-double-at', email: 'jan@@gmail.com', rawData: '{}' },
      { legacyPatientId: 'p-no-domain', email: 'noemail@', rawData: '{}' },
      { legacyPatientId: 'p-no-local', email: '@gmail.com', rawData: '{}' },
      { legacyPatientId: 'p-mailto', email: 'mailto:jan@gmail.com', rawData: '{}' },

      // And the domain that stops before it is one: no suffix, an empty label,
      // a suffix that is not letters, a bare IP.
      { legacyPatientId: 'p-no-suffix', email: 'jan@gmail', rawData: '{}' },
      { legacyPatientId: 'p-empty-label', email: 'jan@.com', rawData: '{}' },
      { legacyPatientId: 'p-trailing-dot', email: 'jan@gmail.', rawData: '{}' },
      { legacyPatientId: 'p-numeric-suffix', email: 'jan@gmail.123', rawData: '{}' },
      { legacyPatientId: 'p-ip-domain', email: 'sanne@192.168.1.1', rawData: '{}' },

      // Punctuation where a dot belongs, and a stray character on the end.
      // Neither is P10's — P10 trims whitespace and folds case and nothing else
      // — so without this rule they reach nobody and nothing asks why.
      { legacyPatientId: 'p-comma-for-dot', email: 'jan.smit@gmail,com', rawData: '{}' },
      { legacyPatientId: 'p-trailing-comma', email: 'jan@gmail.com,', rawData: '{}' },

      // One address and a note beside it. That is not two addresses, so it is
      // not P13's — the cell as a whole is not an address, and it is reported
      // here as one.
      { legacyPatientId: 'p-address-and-note', email: 'jan@gmail.com, geen', rawData: '{}' },

      // Padding around junk. The test is made against the trimmed value —
      // padding is P10's — but `prev` reports the cell exactly as it is stored.
      { legacyPatientId: 'p-padded-junk', email: '  n.v.t.  ', rawData: '{}' },

      // Left alone: an address that is written the way an address is written.
      { legacyPatientId: 'p-clean', email: 'marco.dekker@gmail.com', rawData: '{}' },
      { legacyPatientId: 'p-subdomain', email: 'jan@mail.zorggroep-noord.nl', rawData: '{}' },
      { legacyPatientId: 'p-plus-local', email: 'jan_smit+news@mail.example.org', rawData: '{}' },

      // Left alone: a letter is a letter. An ASCII-only test would report a
      // working domain as junk and waste the time of the human it is asking.
      { legacyPatientId: 'p-unicode-domain', email: 'jan@müller.de', rawData: '{}' },

      // Left alone: an address with capitals or padding is still an address.
      // Those are P10's fix and P10's approval, and this rule is not waiting on
      // them.
      { legacyPatientId: 'p-padded-address', email: '  eva.smit@gmail.com  ', rawData: '{}' },
      { legacyPatientId: 'p-shouted', email: 'JAN.JONES@LIVE.NL', rawData: '{}' },

      // Left alone: a misspelt provider domain is well-formed, and P11 knows
      // what it was meant to be.
      { legacyPatientId: 'p-misspelt', email: 'mei.mulder@gmial.com', rawData: '{}' },

      // Left alone: two addresses in one cell. P13 asks which of them is
      // primary, and saying "this is not an address" about a cell holding two
      // of them would be false.
      {
        legacyPatientId: 'p-two-addresses',
        email: 'eva.smit@gmial.com;eva.smit@live.nl',
        rawData: '{}',
      },
      { legacyPatientId: 'p-two-slash', email: 'jan@gmail.com/eva@live.nl', rawData: '{}' },

      // Left alone: a placeholder that is perfectly well-formed. P14 owns what
      // an address means; this rule owns whether it is one at all, and both of
      // these are.
      { legacyPatientId: 'p-placeholder-test', email: 'test@test.com', rawData: '{}' },
      { legacyPatientId: 'p-placeholder-x', email: 'x@x.x', rawData: '{}' },

      // Left alone: no value at all, which is P15's finding — an absent address
      // is not a wrong one.
      { legacyPatientId: 'p-blank', email: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', email: '', rawData: '{}' },
      { legacyPatientId: 'p-null', email: null, rawData: '{}' },

      // Left alone: junk written into another column entirely. This rule tests
      // one column (1.1.5) and this row's email is an address.
      {
        legacyPatientId: 'p-other-column',
        email: 'piet.jansen@gmail.com',
        fullName: 'n.v.t.',
        phone: 'geen',
        city: '-',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // address here is an address.
      { legacyPatientId: ' p-padded-id ', email: 'sanne.bakker@yahoo.com', rawData: '{}' },
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

  it('reports every cell that is not an email address', async () => {
    const response = await p12.run(context);

    // One call, every row (1.1.14). `column` is the column that was tested
    // (1.1.5), `prev` is the cell verbatim, and `next` is null throughout
    // because the rule is ambiguous (1.1.12).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-address-and-note',
        column: 'email',
        prev: 'jan@gmail.com, geen',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-comma-for-dot',
        column: 'email',
        prev: 'jan.smit@gmail,com',
        next: null,
      },
      { table: 'patient', legacyId: 'p-dash', column: 'email', prev: '-', next: null },
      {
        table: 'patient',
        legacyId: 'p-double-at',
        column: 'email',
        prev: 'jan@@gmail.com',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-empty-label',
        column: 'email',
        prev: 'jan@.com',
        next: null,
      },
      { table: 'patient', legacyId: 'p-geen', column: 'email', prev: 'geen', next: null },
      {
        table: 'patient',
        legacyId: 'p-inner-space',
        column: 'email',
        prev: 'willem.ricci @icloud.com',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-ip-domain',
        column: 'email',
        prev: 'sanne@192.168.1.1',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-mailto',
        column: 'email',
        prev: 'mailto:jan@gmail.com',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-no-domain',
        column: 'email',
        prev: 'noemail@',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-no-local',
        column: 'email',
        prev: '@gmail.com',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-no-suffix',
        column: 'email',
        prev: 'jan@gmail',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-numeric-suffix',
        column: 'email',
        prev: 'jan@gmail.123',
        next: null,
      },
      { table: 'patient', legacyId: 'p-nvt', column: 'email', prev: 'n.v.t.', next: null },
      {
        table: 'patient',
        legacyId: 'p-onbekend',
        column: 'email',
        prev: 'Onbekend',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-padded-junk',
        column: 'email',
        // The padding is reported with the value, not trimmed out of it: the
        // human reads what is really in the column.
        prev: '  n.v.t.  ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-phone',
        column: 'email',
        prev: '06-53549409',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-phone-spaced',
        column: 'email',
        prev: '06 53 54 94 09',
        next: null,
      },
      { table: 'patient', legacyId: 'p-single-x', column: 'email', prev: 'x', next: null },
      {
        table: 'patient',
        legacyId: 'p-trailing-comma',
        column: 'email',
        prev: 'jan@gmail.com,',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-trailing-dot',
        column: 'email',
        prev: 'jan@gmail.',
        next: null,
      },
    ]);
  });

  it('addresses each finding by the row it read the email from', async () => {
    const response = await p12.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `email`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.email).toBe(update.prev);
    }
  });

  it('leaves an address alone, however else it is wrong', async () => {
    const response = await p12.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Written the way an address is written, so this rule has no question to
    // ask about it — including the domains a narrower test would reject: a
    // subdomain, a plus in the local part, and a non-ASCII letter.
    expect(touched).not.toContain('p-clean');
    expect(touched).not.toContain('p-subdomain');
    expect(touched).not.toContain('p-plus-local');
    expect(touched).not.toContain('p-unicode-domain');

    // Capitals, padding and a misspelt provider are P10's and P11's. Each of
    // those cells is still an address, and each of those rules proposes a value
    // this one cannot (1.1.4).
    expect(touched).not.toContain('p-padded-address');
    expect(touched).not.toContain('p-shouted');
    expect(touched).not.toContain('p-misspelt');

    // A placeholder is well-formed, which is exactly why it needs P14 rather
    // than this rule: what is wrong with `test@test.com` is what it means, not
    // whether it is an address.
    expect(touched).not.toContain('p-placeholder-test');
    expect(touched).not.toContain('p-placeholder-x');
  });

  it('leaves two addresses in one cell to P13, and an absent one to P15', async () => {
    const response = await p12.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Two addresses split by P13's separators. The cell holds addresses — the
    // question is which one is primary, and that is P13's question.
    expect(touched).not.toContain('p-two-addresses');
    expect(touched).not.toContain('p-two-slash');

    // Nothing at all in the column. An absent address is not a wrong address,
    // and P15 already asks the human for it.
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');
  });

  it('reads and reports one column, whatever the rest of the row holds', async () => {
    const response = await p12.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // `n.v.t.` in the name, `geen` in the phone and `-` in the city are not
    // this rule's business: it tests `email` and reports against `email`
    // (1.1.5). The padded legacy id is P01's for the same reason.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');

    for (const update of response.updates) {
      expect(update.column).toBe('email');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p12.run(context);

    // The catalogue marks P12 ambiguous: `n.v.t.` does not encode an address a
    // better parser could recover, and the rest of the row identifies a person
    // without saying where their post goes. The flag is rule-wide (1.1.12) —
    // stated once beside the updates — and the `rule` row says the same thing
    // the response does, which is what makes the description the human's only
    // explanation.
    expect(response.ambiguity).toBe(true);
    expect(p12.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
      expect(update.prev).not.toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p12]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P12', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once a real address is written into the cell', async () => {
    const before = await p12.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-nvt');

    // What resolving an ambiguous finding does: a human puts a real value in
    // the column the rule tested (1.1.5). The rule is self-terminating — it
    // tests what it reports on, so the row does not come back.
    await patients.update({ legacyPatientId: 'p-nvt' }, { email: 'jan.devries@gmail.com' });

    const after = await p12.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-nvt');

    await patients.update({ legacyPatientId: 'p-nvt' }, { email: 'n.v.t.' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p12.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — a cell quietly "corrected" into an address most of all.
    expect(before).toHaveLength(37);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P12 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p12);
    expect(p12.ruleId).toBe('P12');
    expect(p12.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p12.ruleName.length).toBeGreaterThan(0);
    expect(p12.description.length).toBeGreaterThan(0);
  });
});
