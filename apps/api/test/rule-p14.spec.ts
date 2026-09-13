import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p14 } from '../src/rules/catalogue/p14';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P14 — a patient `email` holding a placeholder rather than an address,
 * against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 31;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P14 — a patient email that is a placeholder', () => {
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
      // What the rule is for: the three the catalogue names, and the spellings
      // of those same three stand-ins that the fixed list carries with them.
      { legacyPatientId: 'p-test-com', email: 'test@test.com', rawData: '{}' },
      { legacyPatientId: 'p-test-nl', email: 'test@test.nl', rawData: '{}' },
      { legacyPatientId: 'p-test-test', email: 'test@test.test', rawData: '{}' },
      { legacyPatientId: 'p-test-example', email: 'test@example.com', rawData: '{}' },
      { legacyPatientId: 'p-noemail', email: 'noemail@', rawData: '{}' },
      { legacyPatientId: 'p-noemail-hyphen', email: 'no-email@', rawData: '{}' },
      { legacyPatientId: 'p-nomail', email: 'nomail@', rawData: '{}' },
      { legacyPatientId: 'p-noemail-domain', email: 'noemail@noemail.com', rawData: '{}' },
      { legacyPatientId: 'p-x', email: 'x@x.x', rawData: '{}' },
      { legacyPatientId: 'p-a', email: 'a@a.a', rawData: '{}' },

      // A placeholder shouted, and one written half in capitals. A placeholder
      // is the same placeholder in any case, and this rule does not wait for
      // P10's fix to be approved before it says so.
      { legacyPatientId: 'p-shouted', email: 'TEST@TEST.COM', rawData: '{}' },
      { legacyPatientId: 'p-mixed-case', email: 'X@x.X', rawData: '{}' },

      // A placeholder with padding around it. Matched through the padding, and
      // reported with it: `prev` is the cell exactly as it is stored.
      { legacyPatientId: 'p-padded', email: '  noemail@  ', rawData: '{}' },

      // Left alone: a real address, which is what the column is supposed to
      // hold.
      { legacyPatientId: 'p-real', email: 'marco.dekker@gmail.com', rawData: '{}' },

      // Left alone: a real address with padding or capitals. Those are P10's
      // fix, and this rule has no question to ask about the address itself.
      { legacyPatientId: 'p-padded-real', email: '  eva.smit@gmail.com  ', rawData: '{}' },
      { legacyPatientId: 'p-shouted-real', email: 'JAN.JONES@LIVE.NL', rawData: '{}' },

      // Left alone: a misspelt provider. P11's, and it proposes a value — a
      // typo is an address aimed at the right person, not a stand-in for one.
      { legacyPatientId: 'p-misspelt', email: 'mei.mulder@gmial.com', rawData: '{}' },

      // Left alone: a note in the wrong box, with no `@` anywhere in it. Every
      // placeholder on the list carries an `@`; these are P12's, and the
      // sentence it shows about them is the true one.
      { legacyPatientId: 'p-not-address', email: 'n.v.t.', rawData: '{}' },
      { legacyPatientId: 'p-none-word', email: 'none', rawData: '{}' },
      { legacyPatientId: 'p-bare-x', email: 'x', rawData: '{}' },
      { legacyPatientId: 'p-dash', email: '-', rawData: '{}' },

      // Left alone: a truncated address that is not on the list. P12 reports it
      // as a value that is not an address, which is what it is — a domain that
      // went missing, not a stand-in somebody chose.
      { legacyPatientId: 'p-info-truncated', email: 'info@', rawData: '{}' },

      // Left alone: a cell holding a placeholder and a real address. P13's, and
      // the question it asks is the useful one, because there is an address in
      // that cell to keep.
      {
        legacyPatientId: 'p-pair-with-placeholder',
        email: 'test@test.com;jan@live.nl',
        rawData: '{}',
      },

      // Left alone: the near misses the fixed list refuses. `x.com` is a live
      // provider, `test123@test.com` is not the string the list carries, and
      // Testa is somebody's surname. The list is whole values, never a family
      // resemblance — an ambiguous finding against a working address wastes the
      // time of the human it is asking.
      { legacyPatientId: 'p-x-com', email: 'x@x.com', rawData: '{}' },
      { legacyPatientId: 'p-test-numbered', email: 'test123@test.com', rawData: '{}' },
      { legacyPatientId: 'p-testa', email: 'testa.rossi@gmail.com', rawData: '{}' },

      // Left alone: no value at all, which is P15's finding. A placeholder is
      // the opposite of an empty cell — it is the cell pretending not to be
      // empty — and the two sentences differ.
      { legacyPatientId: 'p-blank', email: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', email: '', rawData: '{}' },
      { legacyPatientId: 'p-null', email: null, rawData: '{}' },

      // Left alone: placeholders all over the rest of the row. This rule tests
      // one column (1.1.5) and this row's email is a real address.
      {
        legacyPatientId: 'p-other-column',
        email: 'piet.jansen@gmail.com',
        fullName: 'Test Test',
        phone: 'noemail@',
        city: 'x@x.x',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // address here is a real one.
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

  it('reports every cell holding a placeholder', async () => {
    const response = await p14.run(context);

    // One call, every row (1.1.14). `column` is the column that was tested
    // (1.1.5), `prev` is the cell verbatim, and `next` is null throughout
    // because the rule is ambiguous (1.1.12).
    expect(byLegacyId(response.updates)).toEqual([
      { table: 'patient', legacyId: 'p-a', column: 'email', prev: 'a@a.a', next: null },
      {
        table: 'patient',
        legacyId: 'p-mixed-case',
        column: 'email',
        // Matched through the capitals, reported with them.
        prev: 'X@x.X',
        next: null,
      },
      { table: 'patient', legacyId: 'p-noemail', column: 'email', prev: 'noemail@', next: null },
      {
        table: 'patient',
        legacyId: 'p-noemail-domain',
        column: 'email',
        prev: 'noemail@noemail.com',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-noemail-hyphen',
        column: 'email',
        prev: 'no-email@',
        next: null,
      },
      { table: 'patient', legacyId: 'p-nomail', column: 'email', prev: 'nomail@', next: null },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'email',
        // The padding is reported with the value, not trimmed out of it: the
        // human reads what is really in the column, and trimming it is P10's
        // proposal to make.
        prev: '  noemail@  ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-shouted',
        column: 'email',
        prev: 'TEST@TEST.COM',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-test-com',
        column: 'email',
        prev: 'test@test.com',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-test-example',
        column: 'email',
        prev: 'test@example.com',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-test-nl',
        column: 'email',
        prev: 'test@test.nl',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-test-test',
        column: 'email',
        prev: 'test@test.test',
        next: null,
      },
      { table: 'patient', legacyId: 'p-x', column: 'email', prev: 'x@x.x', next: null },
    ]);
  });

  it('addresses each finding by the row it read the email from', async () => {
    const response = await p14.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `email`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.email).toBe(update.prev);
    }
  });

  it('matches a placeholder through padding and capitals', async () => {
    const response = await p14.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A placeholder shouted, spaced or half-capitalised is the same
    // placeholder. If this rule went quiet until P10's fix had been approved,
    // the row would sit unreported behind a defect that has nothing to do with
    // it — and no rule here waits on another rule's approval.
    expect(touched).toContain('p-shouted');
    expect(touched).toContain('p-mixed-case');
    expect(touched).toContain('p-padded');
  });

  it('leaves a real address alone, however else that address is wrong', async () => {
    const response = await p14.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A real address is what the column is supposed to hold.
    expect(touched).not.toContain('p-real');

    // Padding and capitals are P10's, a misspelt provider is P11's. Each of
    // those cells is aimed at a real person and each of those rules proposes a
    // value this one cannot (1.1.4).
    expect(touched).not.toContain('p-padded-real');
    expect(touched).not.toContain('p-shouted-real');
    expect(touched).not.toContain('p-misspelt');

    // Nothing at all in the column. P15 asks the human for the missing address,
    // and an absent address is not a pretended one.
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');
  });

  it('leaves a value that is not a placeholder address to P12 and P13', async () => {
    const response = await p14.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A note in the wrong box, with no `@` in it at all. Every placeholder on
    // the list carries an `@`, and that is the boundary with P12 — sharing
    // these cells would make this rule a second, quieter copy of it (1.1.4).
    expect(touched).not.toContain('p-not-address');
    expect(touched).not.toContain('p-none-word');
    expect(touched).not.toContain('p-bare-x');
    expect(touched).not.toContain('p-dash');
    expect(touched).not.toContain('p-info-truncated');

    // A placeholder beside a real address is P13's cell, and P13's question —
    // which of these is primary — is the useful one to ask about it.
    expect(touched).not.toContain('p-pair-with-placeholder');
  });

  it('matches whole values only, never a family resemblance', async () => {
    const response = await p14.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // The list is fixed and it is whole values. `x.com` is a live provider,
    // `test123@test.com` is not the string the list carries, and Testa is
    // somebody's surname. Reporting any of these would be an ambiguous finding
    // against an address that may well work, which wastes the time of the human
    // this rule exists to ask. Widening the list is a new version (1.1.1).
    expect(touched).not.toContain('p-x-com');
    expect(touched).not.toContain('p-test-numbered');
    expect(touched).not.toContain('p-testa');
  });

  it('reads and reports one column, whatever the rest of the row holds', async () => {
    const response = await p14.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A test name in `full_name`, a placeholder in `phone` and another in
    // `city` are not this rule's business: it tests `email` and reports against
    // `email` (1.1.5). The padded legacy id is P01's for the same reason.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');

    for (const update of response.updates) {
      expect(update.column).toBe('email');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p14.run(context);

    // The catalogue marks P14 ambiguous: a placeholder encodes that nobody
    // wrote an address down, and the rest of the row cannot supply one. The
    // flag is rule-wide (1.1.12) — stated once beside the updates — and the
    // `rule` row says the same thing the response does, which is what makes the
    // description the human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p14.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
      expect(update.prev).not.toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p14]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P14', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once a real address is in the cell', async () => {
    const before = await p14.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-test-com');

    // What resolving an ambiguous finding does: a human supplies the address
    // and puts it in the column the rule tested (1.1.5). The rule is
    // self-terminating — it tests what it reports on, so the row does not come
    // back.
    await patients.update({ legacyPatientId: 'p-test-com' }, { email: 'ise.dekker@gmail.com' });

    const after = await p14.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-test-com');

    await patients.update({ legacyPatientId: 'p-test-com' }, { email: 'test@test.com' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p14.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — a placeholder quietly blanked most of all.
    expect(before).toHaveLength(FIXTURE_ROWS);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P14 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p14);
    expect(p14.ruleId).toBe('P14');
    expect(p14.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p14.ruleName.length).toBeGreaterThan(0);
    expect(p14.description.length).toBeGreaterThan(0);
  });
});
