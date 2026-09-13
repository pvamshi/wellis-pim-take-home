import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p11 } from '../src/rules/catalogue/p11';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P11 — a patient `email` at a domain that is a known misspelling of a mail
 * provider, against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P11 — a patient email at a misspelt provider domain', () => {
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
      // What the rule is for: each of the three misspellings the catalogue
      // names, on an address that is otherwise clean.
      { legacyPatientId: 'p-gmial', email: 'mei.mulder@gmial.com', rawData: '{}' },
      { legacyPatientId: 'p-hotmial', email: 'teun.smits@hotmial.com', rawData: '{}' },
      { legacyPatientId: 'p-gmai', email: 'levi.petrov@gmai.com', rawData: '{}' },

      // The domain shouted or in title case. A domain carries no case, so the
      // misspelling is the same misspelling and is caught the same way.
      { legacyPatientId: 'p-upper-domain', email: 'sanne.chen@GMIAL.COM', rawData: '{}' },
      { legacyPatientId: 'p-title-domain', email: 'femke.dewit@Hotmial.Com', rawData: '{}' },

      // The whole cell shouted, or padded. Only the domain is this rule's, so
      // the capitals in the local part and the padding around the address come
      // back untouched — they are P10's fix and P10's approval.
      { legacyPatientId: 'p-shouted', email: 'JAN.JONES@GMIAL.COM', rawData: '{}' },
      { legacyPatientId: 'p-padded', email: '  eva.smit@gmial.com  ', rawData: '{}' },
      { legacyPatientId: 'p-padded-shouted', email: ' MEI.MULDER@GMIAL.COM ', rawData: '{}' },

      // Left alone: a domain that is spelt correctly, including the three the
      // list corrects into.
      { legacyPatientId: 'p-gmail', email: 'marco.dekker@gmail.com', rawData: '{}' },
      { legacyPatientId: 'p-hotmail', email: 'lotte.visser@hotmail.com', rawData: '{}' },
      { legacyPatientId: 'p-ziggo', email: 'daan.bakker@ziggo.nl', rawData: '{}' },

      // Left alone: a domain that is not on the list. The rule corrects from a
      // fixed list only — it never measures how close a domain is to a real
      // one, because a near miss is a real mailbox often enough to matter.
      // `gmail.co` is Colombia's, and `live.com` is not `live.nl` mistyped.
      { legacyPatientId: 'p-gmail-co', email: 'noor.jansen@gmail.co', rawData: '{}' },
      { legacyPatientId: 'p-live-com', email: 'stijn.mol@live.com', rawData: '{}' },
      { legacyPatientId: 'p-hotmai', email: 'ruben.berg@hotmai.com', rawData: '{}' },
      { legacyPatientId: 'p-unknown', email: 'anouk.vos@bedrijfsmail.nl', rawData: '{}' },

      // Left alone: the misspelling is in the local part, not the domain. This
      // rule tests the domain, and nobody knows what the local part was meant
      // to be.
      { legacyPatientId: 'p-local-lookalike', email: 'gmial.com@gmail.com', rawData: '{}' },

      // Left alone: not one address, so there is no single domain to test. A
      // gap inside the address and a cell holding two addresses are P12's and
      // P13's, and they report the cell whole — even when one of the two is at
      // a misspelt domain.
      { legacyPatientId: 'p-inner-space', email: 'willem.ricci @gmial.com', rawData: '{}' },
      {
        legacyPatientId: 'p-two-addresses',
        email: 'eva.smit@gmial.com;eva.smit@live.nl',
        rawData: '{}',
      },

      // Left alone: no address at all, so no domain either. P12 reports what
      // the cell really is, and `noemail@` is P14's placeholder.
      { legacyPatientId: 'p-not-an-address', email: 'n.v.t.', rawData: '{}' },
      { legacyPatientId: 'p-no-domain', email: 'noemail@', rawData: '{}' },

      // Left alone: the address is absent, which is P15's finding.
      { legacyPatientId: 'p-blank', email: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', email: '', rawData: '{}' },
      { legacyPatientId: 'p-null', email: null, rawData: '{}' },

      // Left alone: a misspelt provider written into another column entirely.
      // P11 tests one column (1.1.5) and this row's email is clean.
      {
        legacyPatientId: 'p-other-column',
        email: 'piet.jansen@gmail.com',
        fullName: 'piet.jansen@gmial.com',
        city: 'gmial.com',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // address here is clean.
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

  it('proposes the corrected domain for every address at a misspelt provider', async () => {
    const response = await p11.run(context);

    // The value matters, not just that the rule fired: each `next` is the same
    // address with its domain replaced by the one the list gives, and nothing
    // else about the cell touched. One call, every row (1.1.14), and `column`
    // is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-gmai',
        column: 'email',
        prev: 'levi.petrov@gmai.com',
        next: 'levi.petrov@gmail.com',
      },
      {
        table: 'patient',
        legacyId: 'p-gmial',
        column: 'email',
        prev: 'mei.mulder@gmial.com',
        next: 'mei.mulder@gmail.com',
      },
      {
        table: 'patient',
        legacyId: 'p-hotmial',
        column: 'email',
        prev: 'teun.smits@hotmial.com',
        next: 'teun.smits@hotmail.com',
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'email',
        prev: '  eva.smit@gmial.com  ',
        // The padding stays. Trimming it is P10's fix, and this rule proposes
        // one thing: the domain (1.1.4).
        next: '  eva.smit@gmail.com  ',
      },
      {
        table: 'patient',
        legacyId: 'p-padded-shouted',
        column: 'email',
        prev: ' MEI.MULDER@GMIAL.COM ',
        // Both of P10's defects survive the fix, on purpose: the capitals in
        // the local part and the spaces at the ends. What changed is the
        // domain, and a human reading the proposal can see that at a glance.
        next: ' MEI.MULDER@gmail.com ',
      },
      {
        table: 'patient',
        legacyId: 'p-shouted',
        column: 'email',
        prev: 'JAN.JONES@GMIAL.COM',
        next: 'JAN.JONES@gmail.com',
      },
      {
        table: 'patient',
        legacyId: 'p-title-domain',
        column: 'email',
        prev: 'femke.dewit@Hotmial.Com',
        next: 'femke.dewit@hotmail.com',
      },
      {
        table: 'patient',
        legacyId: 'p-upper-domain',
        column: 'email',
        prev: 'sanne.chen@GMIAL.COM',
        next: 'sanne.chen@gmail.com',
      },
    ]);
  });

  it('addresses each finding by the row it read the email from', async () => {
    const response = await p11.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `email`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the address it reports as
    // `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.email).toBe(update.prev);
    }
  });

  it('corrects from the fixed list only, and leaves every other cell alone', async () => {
    const response = await p11.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A correctly spelt provider has nothing to fix — including the three the
    // list corrects into, which keeps the rule self-terminating.
    expect(touched).not.toContain('p-gmail');
    expect(touched).not.toContain('p-hotmail');
    expect(touched).not.toContain('p-ziggo');

    // A domain that is not on the list is left as it is, however close to one
    // it looks. This is what "from a fixed list only" rules out: a rewritten
    // working address is worse than the defect it was cleaning.
    expect(touched).not.toContain('p-gmail-co');
    expect(touched).not.toContain('p-live-com');
    expect(touched).not.toContain('p-hotmai');
    expect(touched).not.toContain('p-unknown');

    // The domain is what is tested, so a misspelling sitting in the local part
    // is not this rule's to correct.
    expect(touched).not.toContain('p-local-lookalike');

    // Not one address, so there is no single domain in the cell: a gap inside
    // it is P12's, two addresses in one cell are P13's, a note rather than an
    // address is P12's, and `noemail@` is P14's. Each reports the cell whole
    // (1.1.4).
    expect(touched).not.toContain('p-inner-space');
    expect(touched).not.toContain('p-two-addresses');
    expect(touched).not.toContain('p-not-an-address');
    expect(touched).not.toContain('p-no-domain');

    // No address at all, which is P15's finding.
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');

    // And no other column is proposed against, whatever it holds (1.1.5) —
    // including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('email');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries a proposed value', async () => {
    const response = await p11.run(context);

    // The catalogue does not mark P11 ambiguous: a domain on the list has one
    // correction and the rule looks it up rather than guessing. The flag is
    // rule-wide (1.1.12), stated once beside the updates, and the `rule` row
    // says the same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p11.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);

      // Whatever is proposed differs from the cell in its domain and in
      // nothing else: same padding, same local part, same `@`.
      const previous = update.prev ?? '';
      const proposed = update.next ?? '';
      const at = previous.indexOf('@');
      expect(proposed.slice(0, at + 1)).toBe(previous.slice(0, at + 1));
      expect(proposed.length - proposed.trimEnd().length).toBe(
        previous.length - previous.trimEnd().length,
      );
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p11.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-gmial');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). The corrected domain is not a key in the list, so the
    // rule is self-terminating and the applied row needs no guard to keep it
    // from being re-proposed.
    await patients.update({ legacyPatientId: 'p-gmial' }, { email: 'mei.mulder@gmail.com' });

    const after = await p11.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-gmial');

    await patients.update({ legacyPatientId: 'p-gmial' }, { email: 'mei.mulder@gmial.com' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p11.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(25);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P11 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p11);
    expect(p11.ruleId).toBe('P11');
    expect(p11.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p11.ruleName.length).toBeGreaterThan(0);
    expect(p11.description.length).toBeGreaterThan(0);
  });
});
