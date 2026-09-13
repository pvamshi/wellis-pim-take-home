import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p31 } from '../src/rules/catalogue/p31';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P31 — a patient `phone` that spells the international call prefix as `00` in
 * front of a country code, against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P31 — a patient phone starting 00 in front of a country code', () => {
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
      // The prefix the catalogue names, in front of country codes of one, two
      // and three digits. Every one of these is a real number written for a
      // dialler standing in the Netherlands.
      { legacyPatientId: 'p-nl', phone: '0031612345678', rawData: '{}' },
      { legacyPatientId: 'p-nllandline', phone: '0031201234567', rawData: '{}' },
      { legacyPatientId: 'p-be', phone: '0032475123456', rawData: '{}' },
      { legacyPatientId: 'p-de', phone: '0049301234567', rawData: '{}' },
      { legacyPatientId: 'p-us', phone: '0012025550123', rawData: '{}' },
      { legacyPatientId: 'p-pt', phone: '00351912345678', rawData: '{}' },

      // What the digits add up to is not this rule's question: the trunk zero
      // the international form does not need stays where it is, and a number
      // far too short to be anybody's still has its prefix rewritten. Both are
      // P33's finding afterwards, and dropping the zero would be a second fix
      // in one rule (1.1.4).
      { legacyPatientId: 'p-trunkzero', phone: '00310612345678', rawData: '{}' },
      { legacyPatientId: 'p-tooshort', phone: '0031612', rawData: '{}' },

      // Left alone: already the value this rule produces, so there is nothing
      // to propose — and a cell carrying both notations at once, which is not
      // a prefix to rewrite but a cell nobody can read as one number.
      { legacyPatientId: 'p-plus', phone: '+31612345678', rawData: '{}' },
      { legacyPatientId: 'p-plusdoubleoh', phone: '+0031612345678', rawData: '{}' },

      // Left alone: no exit prefix in front. A national Dutch number wanting
      // its +31 is P32's fix, because that one has to know which country the
      // number is from and this one is told by the cell.
      { legacyPatientId: 'p-national', phone: '0612345678', rawData: '{}' },
      { legacyPatientId: 'p-landline', phone: '0201234567', rawData: '{}' },

      // Left alone, and these are the rows that matter most: a third zero. No
      // country calling code begins with `0`, so what follows the `00` here is
      // not one — these are the placeholder shapes P35 reports, and proposing
      // `+0000000` would turn junk into something that looks like a number.
      { legacyPatientId: 'p-placeholder', phone: '000000000', rawData: '{}' },
      { legacyPatientId: 'p-thirdzero', phone: '0001234567', rawData: '{}' },
      { legacyPatientId: 'p-allzeroes', phone: '0000000000', rawData: '{}' },
      { legacyPatientId: 'p-doubleohonly', phone: '00', rawData: '{}' },

      // Left alone: the same number with grouping or padding still on it.
      // Taking that out is P30's fix, and this rule reads what P30 leaves
      // behind — cleaning the cell and rewriting the prefix are two findings a
      // human sees one after the other (1.1.4).
      { legacyPatientId: 'p-grouped', phone: '00 31 6 1234 5678', rawData: '{}' },
      { legacyPatientId: 'p-dashes', phone: '0031-6-12345678', rawData: '{}' },
      { legacyPatientId: 'p-padded', phone: '  0031612345678  ', rawData: '{}' },

      // Left alone: something that is not a digit in the cell. Those go to P30
      // or P34 whole, never through a prefix rewrite that would carry a stray
      // character along with it.
      { legacyPatientId: 'p-extension', phone: '0031612345678 ext 12', rawData: '{}' },
      { legacyPatientId: 'p-word', phone: 'onbekend', rawData: '{}' },

      // Left alone: no value in the column at all, and an empty cell. There is
      // no prefix here to rewrite; an empty phone is P36's finding.
      { legacyPatientId: 'p-null', phone: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', phone: '', rawData: '{}' },

      // Left alone: a `00` prefix spelled into other columns entirely. P31
      // tests one column and changes that column (1.1.5), and this row's phone
      // is already international.
      {
        legacyPatientId: 'p-othercolumn',
        phone: '+31612345678',
        bsn: '0031234567',
        weight: '0031',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // phone here is already international.
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

  it('proposes the plus and the country code for every 00-prefixed number', async () => {
    const response = await p31.run(context);

    // The value matters, not just that the rule fired: each `next` is the same
    // number with `00` written as `+`, every digit after the prefix carried
    // across in order, nothing added and nothing dropped. One call, every row
    // (1.1.14), and `column` is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-be',
        column: 'phone',
        prev: '0032475123456',
        next: '+32475123456',
      },
      {
        table: 'patient',
        legacyId: 'p-de',
        column: 'phone',
        prev: '0049301234567',
        next: '+49301234567',
      },
      {
        table: 'patient',
        legacyId: 'p-nl',
        column: 'phone',
        prev: '0031612345678',
        next: '+31612345678',
      },
      {
        table: 'patient',
        legacyId: 'p-nllandline',
        column: 'phone',
        prev: '0031201234567',
        next: '+31201234567',
      },
      {
        table: 'patient',
        legacyId: 'p-pt',
        column: 'phone',
        prev: '00351912345678',
        // A three-digit country code is read no differently: the rule takes
        // the `00` off the front and leaves the rest alone, so it never has to
        // decide where the country code ends.
        next: '+351912345678',
      },
      {
        table: 'patient',
        legacyId: 'p-tooshort',
        column: 'phone',
        prev: '0031612',
        // Too short to be anybody's number, and the prefix is still wrong.
        // Saying it is too short is P33's finding, not a reason to leave the
        // `00` standing.
        next: '+31612',
      },
      {
        table: 'patient',
        legacyId: 'p-trunkzero',
        column: 'phone',
        prev: '00310612345678',
        // The trunk zero the international form does not need stays: dropping
        // it is a second fix (1.1.4) and a decision about which number the
        // cell meant. That the result is too long is P33's finding.
        next: '+310612345678',
      },
      {
        table: 'patient',
        legacyId: 'p-us',
        column: 'phone',
        prev: '0012025550123',
        // A one-digit country code, and the digit after the `00` is what
        // proves the `00` is a prefix at all.
        next: '+12025550123',
      },
    ]);
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p31.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `phone`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.phone).toBe(update.prev);
    }
  });

  it('leaves plus numbers, national numbers, zero runs and uncleaned cells alone', async () => {
    const response = await p31.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Already international, or carrying both notations at once.
    expect(touched).not.toContain('p-plus');
    expect(touched).not.toContain('p-plusdoubleoh');

    // No exit prefix in front of them at all — P32's numbers.
    expect(touched).not.toContain('p-national');
    expect(touched).not.toContain('p-landline');

    // A third zero, so what follows the `00` is not a country code. These are
    // P35's placeholders and they are never rewritten into `+0…`.
    expect(touched).not.toContain('p-placeholder');
    expect(touched).not.toContain('p-thirdzero');
    expect(touched).not.toContain('p-allzeroes');
    expect(touched).not.toContain('p-doubleohonly');

    // Grouping or padding still on the cell: P30 cleans it first, and this
    // rule reads what P30 leaves behind.
    expect(touched).not.toContain('p-grouped');
    expect(touched).not.toContain('p-dashes');
    expect(touched).not.toContain('p-padded');

    // Something that is not a digit in the cell.
    expect(touched).not.toContain('p-extension');
    expect(touched).not.toContain('p-word');

    // Nothing in the column to rewrite.
    expect(touched).not.toContain('p-null');
    expect(touched).not.toContain('p-empty');

    // And no other column is proposed against, whatever it holds (1.1.5) —
    // including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-othercolumn');
    expect(touched).not.toContain(' p-paddedid ');
    for (const update of response.updates) {
      expect(update.column).toBe('phone');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries the number it read', async () => {
    const response = await p31.run(context);

    // The catalogue does not mark P31 ambiguous: `00` and `+` are the same
    // instruction written two ways, so rewriting one as the other is reading
    // the cell rather than guessing at it. The flag is rule-wide (1.1.12),
    // stated once beside the updates, and the `rule` row says the same thing
    // the response does.
    expect(response.ambiguity).toBe(false);
    expect(p31.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);

      const proposed = update.next ?? '';
      const previous = update.prev ?? '';

      // What was read: bare digits with the exit prefix in front of a country
      // code that does not start with a zero.
      expect(previous).toMatch(/^00[1-9][0-9]*$/);

      // What is proposed: a `+`, then exactly the digits that followed the
      // `00`, in the same order. No digit added, dropped or reordered, and
      // nothing of the number itself judged.
      expect(proposed).toMatch(/^\+[1-9][0-9]*$/);
      expect(proposed).toBe(`+${previous.slice(2)}`);
      expect(proposed.slice(1)).toBe(previous.slice(2));
      expect(proposed).toHaveLength(previous.length - 1);
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p31.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-nl');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). What it proposes starts with a `+` rather than `00`, so
    // the rule is self-terminating and the applied row needs no guard to keep
    // it from being re-proposed.
    await patients.update({ legacyPatientId: 'p-nl' }, { phone: '+31612345678' });

    const after = await p31.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-nl');

    await patients.update({ legacyPatientId: 'p-nl' }, { phone: '0031612345678' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p31.run(context);

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

  it('is registered in the catalogue as P31 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p31);
    expect(p31.ruleId).toBe('P31');
    expect(p31.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p31.ruleName.length).toBeGreaterThan(0);
    expect(p31.description.length).toBeGreaterThan(0);
  });
});
