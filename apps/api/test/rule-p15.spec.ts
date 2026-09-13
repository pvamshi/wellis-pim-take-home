import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p15 } from '../src/rules/catalogue/p15';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P15 — a patient row with no `email` at all, against a real database with real
 * rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 18;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P15 — a patient email that is empty', () => {
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
      // What the rule is for, in all three ways a cell arrives with no address
      // in it: the column absent, the cell empty, and the cell typed into with
      // nothing but spacing. The whitespace ones are P10's handoff — trimming
      // them would propose the very state reported here.
      { legacyPatientId: 'p-null', email: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', email: '', rawData: '{}' },
      { legacyPatientId: 'p-spaces', email: '   ', rawData: '{}' },
      { legacyPatientId: 'p-tab', email: '\t', rawData: '{}' },
      { legacyPatientId: 'p-newline', email: '\n ', rawData: '{}' },

      // Reported too, and reported anyway: the rest of the row carries plenty
      // to identify this person by and none of it is an address. This is the
      // row that proves the rule does not construct one from a name, a phone
      // number or a city — the column is a login, and a guessed address hands
      // an account to whoever already owns it.
      {
        legacyPatientId: 'p-empty-with-contact',
        email: '',
        fullName: 'Jan de Vries',
        phone: '06-53549409',
        dob: '1978-04-02',
        city: 'Utrecht',
        rawData: '{}',
      },

      // Left alone: a real address, which is what the column is supposed to
      // hold.
      { legacyPatientId: 'p-real', email: 'marco.dekker@gmail.com', rawData: '{}' },

      // Left alone: padding and capitals around a real address. P10's fix, and
      // the cell is untidy rather than absent.
      { legacyPatientId: 'p-padded-real', email: '  eva.smit@gmail.com  ', rawData: '{}' },
      { legacyPatientId: 'p-shouted-real', email: 'JAN.JONES@LIVE.NL', rawData: '{}' },

      // Left alone: a misspelt provider. P11's fix.
      { legacyPatientId: 'p-misspelt', email: 'mei.mulder@gmial.com', rawData: '{}' },

      // Left alone: a note in the wrong box. P12's finding — a cell pretending
      // not to be empty is not an empty cell, and the two sentences differ.
      { legacyPatientId: 'p-not-address', email: 'n.v.t.', rawData: '{}' },
      { legacyPatientId: 'p-geen', email: 'geen', rawData: '{}' },
      { legacyPatientId: 'p-dash', email: '-', rawData: '{}' },

      // Left alone: a placeholder, which is the same pretence with an `@` in
      // it. P14's finding.
      { legacyPatientId: 'p-placeholder', email: 'test@test.com', rawData: '{}' },
      { legacyPatientId: 'p-noemail', email: 'noemail@', rawData: '{}' },

      // Left alone: two addresses in one cell, which is the opposite problem.
      // P13's finding.
      { legacyPatientId: 'p-pair', email: 'eva@gmial.com;eva@live.nl', rawData: '{}' },

      // Left alone: emptiness in every other column. P36 owns an empty `phone`,
      // P40 an empty `city`, P22 an empty `dob` — this rule tests one column
      // (1.1.5) and this row's email is a real address.
      {
        legacyPatientId: 'p-other-column-empty',
        email: 'piet.jansen@gmail.com',
        fullName: '',
        phone: '   ',
        dob: '',
        city: null,
        rawData: '{}',
      },

      // Reported, and the id is reported exactly as the row holds it: padding
      // on the id is P01's fix and an empty id is P02's finding, and neither
      // stops this rule from saying that this row has no address.
      { legacyPatientId: ' p-padded-id ', email: '', rawData: '{}' },
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

  it('reports every row whose email is absent, empty or nothing but whitespace', async () => {
    const response = await p15.run(context);

    // One call, every row (1.1.14). `column` is the column that was tested
    // (1.1.5), `prev` is what it held verbatim — so `null`, `''` and `'   '`
    // stay three distinguishable things to the human reading the row — and
    // `next` is null on all of them because there is nothing to propose.
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: ' p-padded-id ',
        column: 'email',
        prev: '',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-empty',
        column: 'email',
        prev: '',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-empty-with-contact',
        column: 'email',
        prev: '',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-newline',
        column: 'email',
        prev: '\n ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-null',
        column: 'email',
        prev: null,
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-spaces',
        column: 'email',
        prev: '   ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-tab',
        column: 'email',
        prev: '\t',
        next: null,
      },
    ]);
  });

  it('addresses each finding by the row it read the email from', async () => {
    const response = await p15.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `email`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.email).toBe(update.prev);
    }
  });

  it('reports a row that carries every other contact detail but an address', async () => {
    const response = await p15.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A name, a phone number, a date of birth and a city say who this person is
    // and not one of them says where their post goes. The row is reported and
    // nothing is proposed — the column is a login, and inventing an address
    // would hand an account to whoever already owns it.
    expect(touched).toContain('p-empty-with-contact');

    const finding = response.updates.find((update) => update.legacyId === 'p-empty-with-contact');
    expect(finding?.next).toBeNull();
  });

  it('leaves a cell with something in it alone, however wrong that something is', async () => {
    const response = await p15.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A real address is what the column is supposed to hold.
    expect(touched).not.toContain('p-real');

    // Padding and capitals are P10's fix, a misspelt provider is P11's. Each of
    // those cells holds an address; it is untidy or aimed slightly wrong, not
    // absent (1.1.4).
    expect(touched).not.toContain('p-padded-real');
    expect(touched).not.toContain('p-shouted-real');
    expect(touched).not.toContain('p-misspelt');

    // A note in the wrong box is P12's and a placeholder is P14's. Both are
    // cells pretending not to be empty, and the sentence each of those rules
    // shows about them is the true one. This rule finds the honest ones.
    expect(touched).not.toContain('p-not-address');
    expect(touched).not.toContain('p-geen');
    expect(touched).not.toContain('p-dash');
    expect(touched).not.toContain('p-placeholder');
    expect(touched).not.toContain('p-noemail');

    // Two addresses in one cell are P13's, which is the opposite problem.
    expect(touched).not.toContain('p-pair');
  });

  it('reads and reports one column, however empty the rest of the row is', async () => {
    const response = await p15.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // An empty `full_name`, `phone`, `dob` and `city` on one row, and none of
    // them this rule's: it tests `email` and reports against `email` (1.1.5).
    expect(touched).not.toContain('p-other-column-empty');

    for (const update of response.updates) {
      expect(update.column).toBe('email');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p15.run(context);

    // The catalogue marks P15 ambiguous: an address is not derivable from a
    // name, a date of birth, a phone number or anything else the export holds,
    // so there is nothing to propose. The flag is rule-wide (1.1.12) — stated
    // once beside the updates — and the `rule` row says the same thing the
    // response does, which is what makes the description the human's only
    // explanation.
    expect(response.ambiguity).toBe(true);
    expect(p15.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p15]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P15', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once an address is in the cell', async () => {
    const before = await p15.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-spaces');

    // What resolving an ambiguous finding does: a human supplies the address
    // and puts it in the column the rule tested (1.1.5). The rule is
    // self-terminating — it tests what it reports on, so the row does not come
    // back.
    await patients.update({ legacyPatientId: 'p-spaces' }, { email: 'ise.dekker@gmail.com' });

    const after = await p15.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-spaces');

    await patients.update({ legacyPatientId: 'p-spaces' }, { email: '   ' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p15.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — an empty address quietly filled in most of all.
    expect(before).toHaveLength(FIXTURE_ROWS);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P15 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p15);
    expect(p15.ruleId).toBe('P15');
    expect(p15.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p15.ruleName.length).toBeGreaterThan(0);
    expect(p15.description.length).toBeGreaterThan(0);
  });
});
