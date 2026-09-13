import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p10 } from '../src/rules/catalogue/p10';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P10 — a patient `email` padded at the ends or written in capitals, against a
 * real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P10 — a patient email with whitespace or capitals', () => {
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
      // What the rule is for: padding on one end, the other, or both; tabs and
      // newlines, which are whitespace too.
      { legacyPatientId: 'p-lead', email: '  teun.smits@gmail.com', rawData: '{}' },
      { legacyPatientId: 'p-trail', email: 'teun.smits@gmail.com  ', rawData: '{}' },
      { legacyPatientId: 'p-both', email: ' teun.smits@gmail.com ', rawData: '{}' },
      { legacyPatientId: 'p-tab', email: '\tteun.smits@gmail.com\n', rawData: '{}' },

      // Case, in every shape it arrives in: the domain alone, the address
      // shouted whole, and title case across both halves.
      { legacyPatientId: 'p-domain-case', email: 'levi.petrov@Kpnmail.NL', rawData: '{}' },
      { legacyPatientId: 'p-shouted', email: 'JAN.JONES@LIVE.NL', rawData: '{}' },
      { legacyPatientId: 'p-title', email: 'Elena.Vos@Protonmail.Com', rawData: '{}' },

      // Only the local part is shouted. The domain is already lower case, so
      // the address still is not the one that gets stored.
      { legacyPatientId: 'p-local-case', email: 'SANNE.CHEN@kpnmail.nl', rawData: '{}' },

      // Both defects at once, which is one fix, not two: the normalised address.
      { legacyPatientId: 'p-both-defects', email: '  FEMKE.DEWIT@ICLOUD.COM  ', rawData: '{}' },

      // Case and padding are all this rule fixes. The address stays a provider
      // typo (P11) and stays a placeholder (P14) — other rules, other approvals.
      { legacyPatientId: 'p-typo', email: ' MEI.MULDER@GMIAL.COM ', rawData: '{}' },
      { legacyPatientId: 'p-placeholder', email: 'TEST@TEST.COM', rawData: '{}' },

      // Left alone: already normalised.
      { legacyPatientId: 'p-clean', email: 'marco.dekker@gmail.com', rawData: '{}' },

      // Left alone: not one address, so there is no domain here to lower-case.
      // A gap inside the address and a cell holding two of them are P12's and
      // P13's findings, and they report the cell whole.
      { legacyPatientId: 'p-inner-space', email: ' willem.ricci @icloud.com ', rawData: '{}' },
      {
        legacyPatientId: 'p-two-addresses',
        email: 'EVA.SMIT@OUTLOOK.COM;eva.smit@live.nl',
        rawData: '{}',
      },

      // Left alone: no address at all. Lower-casing a note in the email column
      // proposes a tidier non-answer; P12 reports what the cell really is.
      { legacyPatientId: 'p-not-an-address', email: '  N.V.T.  ', rawData: '{}' },
      { legacyPatientId: 'p-dash', email: '-', rawData: '{}' },

      // Left alone: nothing on one side of the `@`, which is P14's placeholder.
      { legacyPatientId: 'p-no-domain', email: 'NOEMAIL@', rawData: '{}' },

      // Left alone: the address is absent, which is P15's finding, and a trim
      // that leaves nothing would propose that very state.
      { legacyPatientId: 'p-blank', email: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', email: '', rawData: '{}' },
      { legacyPatientId: 'p-null', email: null, rawData: '{}' },

      // Left alone: capitals and padding on other columns entirely. P10 tests
      // one column (1.1.5) and this row's email is clean.
      {
        legacyPatientId: 'p-other-column',
        email: 'piet.jansen@gmail.com',
        fullName: '  PIET JANSEN  ',
        city: '  UTRECHT  ',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's.
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

  it('proposes the normalised address for every padded or capitalised email', async () => {
    const response = await p10.run(context);

    // The value matters, not just that the rule fired: each `next` is the
    // address trimmed at both ends and lower-cased, and nothing else done to
    // it. One call, every row (1.1.14), and `column` is the column that was
    // tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-both',
        column: 'email',
        prev: ' teun.smits@gmail.com ',
        next: 'teun.smits@gmail.com',
      },
      {
        table: 'patient',
        legacyId: 'p-both-defects',
        column: 'email',
        prev: '  FEMKE.DEWIT@ICLOUD.COM  ',
        next: 'femke.dewit@icloud.com',
      },
      {
        table: 'patient',
        legacyId: 'p-domain-case',
        column: 'email',
        prev: 'levi.petrov@Kpnmail.NL',
        next: 'levi.petrov@kpnmail.nl',
      },
      {
        table: 'patient',
        legacyId: 'p-lead',
        column: 'email',
        prev: '  teun.smits@gmail.com',
        next: 'teun.smits@gmail.com',
      },
      {
        table: 'patient',
        legacyId: 'p-local-case',
        column: 'email',
        // The local part is folded too. The catalogue asks for a lower-cased
        // address, and half-folding one would leave the login value the export
        // arrived with.
        prev: 'SANNE.CHEN@kpnmail.nl',
        next: 'sanne.chen@kpnmail.nl',
      },
      {
        table: 'patient',
        legacyId: 'p-placeholder',
        column: 'email',
        prev: 'TEST@TEST.COM',
        // Still a placeholder afterwards. P10 folded the case and left the rest
        // of the problem to P14 (1.1.4).
        next: 'test@test.com',
      },
      {
        table: 'patient',
        legacyId: 'p-shouted',
        column: 'email',
        prev: 'JAN.JONES@LIVE.NL',
        next: 'jan.jones@live.nl',
      },
      {
        table: 'patient',
        legacyId: 'p-tab',
        column: 'email',
        prev: '\tteun.smits@gmail.com\n',
        next: 'teun.smits@gmail.com',
      },
      {
        table: 'patient',
        legacyId: 'p-title',
        column: 'email',
        prev: 'Elena.Vos@Protonmail.Com',
        next: 'elena.vos@protonmail.com',
      },
      {
        table: 'patient',
        legacyId: 'p-trail',
        column: 'email',
        prev: 'teun.smits@gmail.com  ',
        next: 'teun.smits@gmail.com',
      },
      {
        table: 'patient',
        legacyId: 'p-typo',
        column: 'email',
        prev: ' MEI.MULDER@GMIAL.COM ',
        // Still the wrong provider afterwards. Correcting `gmial.com` is P11's
        // fix and P11's approval (1.1.4).
        next: 'mei.mulder@gmial.com',
      },
    ]);
  });

  it('addresses each finding by the row it read the email from', async () => {
    const response = await p10.run(context);

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

  it('leaves a clean address, a cell that is not one address, and a missing one alone', async () => {
    const response = await p10.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A normalised address has nothing to fix.
    expect(touched).not.toContain('p-clean');

    // Not one address, so there is no domain in the cell to lower-case: a gap
    // inside it is P12's, two addresses in one cell are P13's, a cell holding a
    // note rather than an address is P12's, and `noemail@` is P14's. Each of
    // them reports the cell whole (1.1.4).
    expect(touched).not.toContain('p-inner-space');
    expect(touched).not.toContain('p-two-addresses');
    expect(touched).not.toContain('p-not-an-address');
    expect(touched).not.toContain('p-dash');
    expect(touched).not.toContain('p-no-domain');

    // No address at all. Trimming leaves nothing, which is the empty address
    // P15 asks a human about, so proposing it here would be a second fix.
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');

    // And no other column is proposed against, however dirty it is (1.1.5) —
    // including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('email');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries a proposed value', async () => {
    const response = await p10.run(context);

    // The catalogue does not mark P10 ambiguous: there is one normalised form
    // of an address. The flag is rule-wide (1.1.12), stated once beside the
    // updates, and the `rule` row says the same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p10.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);
      expect(update.next?.trim()).toBe(update.next);
      expect(update.next).toBe(update.next?.toLowerCase());
      // Whatever is proposed is still the address that was there, only trimmed
      // and folded — no character added, removed or replaced (1.1.4).
      expect(update.next).toBe(update.prev?.trim().toLowerCase());
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p10.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-shouted');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). The rule is self-terminating, so the applied row needs no
    // guard to keep it from being re-proposed.
    await patients.update({ legacyPatientId: 'p-shouted' }, { email: 'jan.jones@live.nl' });

    const after = await p10.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-shouted');

    await patients.update({ legacyPatientId: 'p-shouted' }, { email: 'JAN.JONES@LIVE.NL' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p10.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(22);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P10 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p10);
    expect(p10.ruleId).toBe('P10');
    expect(p10.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p10.ruleName.length).toBeGreaterThan(0);
    expect(p10.description.length).toBeGreaterThan(0);
  });
});
