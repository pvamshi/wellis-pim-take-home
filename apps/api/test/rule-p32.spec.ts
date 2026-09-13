import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p32 } from '../src/rules/catalogue/p32';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P32 — a patient `phone` written as a national Dutch number, with the trunk
 * zero in front and no country code, against a real database with real rows.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P32 — a patient phone that is a national Dutch number', () => {
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
      // The shape the catalogue names first: `06`, the Dutch mobile prefix,
      // which is most of this column.
      { legacyPatientId: 'p-mobile', phone: '0612345678', rawData: '{}' },
      { legacyPatientId: 'p-mobile2', phone: '0687654321', rawData: '{}' },

      // And the rest of the same shape — one leading zero and no country code.
      // A landline area code is the same cell wanting the same fix, so mobile
      // and landline are not split into two rules (1.1.4).
      { legacyPatientId: 'p-amsterdam', phone: '0201234567', rawData: '{}' },
      { legacyPatientId: 'p-rotterdam', phone: '0101234567', rawData: '{}' },
      { legacyPatientId: 'p-groningen', phone: '0501234567', rawData: '{}' },
      { legacyPatientId: 'p-service', phone: '0900123456', rawData: '{}' },

      // What the digits add up to is not this rule's question: a national
      // number a digit short still has a trunk zero and still has no country
      // code. Being too short is P33's finding afterwards.
      { legacyPatientId: 'p-tooshort', phone: '061234567', rawData: '{}' },

      // Left alone, and this is the row that matters most: a second zero makes
      // the front an international exit prefix, not a trunk zero. That is a
      // Belgian number, and treating its zero as Dutch would propose
      // `+310032475123456` — the mistake the phone rules were split to avoid.
      { legacyPatientId: 'p-belgian', phone: '0032475123456', rawData: '{}' },
      { legacyPatientId: 'p-dutchexit', phone: '0031612345678', rawData: '{}' },

      // Left alone: a run of zeroes is neither a trunk zero nor a country
      // code. `000000000` is the placeholder shape P35 reports.
      { legacyPatientId: 'p-placeholder', phone: '000000000', rawData: '{}' },
      { legacyPatientId: 'p-zeroonly', phone: '0', rawData: '{}' },
      { legacyPatientId: 'p-zeroes', phone: '0000000000', rawData: '{}' },

      // Left alone: already international. There is nothing implied left to
      // write out, and a number that already says which country it is from is
      // never given a second one.
      { legacyPatientId: 'p-plus31', phone: '+31612345678', rawData: '{}' },
      { legacyPatientId: 'p-plus32', phone: '+32475123456', rawData: '{}' },
      { legacyPatientId: 'p-plustrunk', phone: '+310612345678', rawData: '{}' },

      // Left alone: no leading zero, so not the national spelling. Deciding
      // whether these digits are a number missing its trunk zero or a country
      // code missing its `+` is a guess this rule does not make.
      { legacyPatientId: 'p-notrunk', phone: '612345678', rawData: '{}' },
      { legacyPatientId: 'p-bare31', phone: '31612345678', rawData: '{}' },

      // Left alone: the same number with grouping or padding still on it.
      // Taking that out is P30's fix, and this rule reads what P30 leaves
      // behind — cleaning the cell and writing out the country code are two
      // findings a human sees one after the other (1.1.4).
      { legacyPatientId: 'p-grouped', phone: '06 12 34 56 78', rawData: '{}' },
      { legacyPatientId: 'p-dashes', phone: '06-12345678', rawData: '{}' },
      { legacyPatientId: 'p-padded', phone: '  0612345678  ', rawData: '{}' },

      // Left alone: something that is not a digit in the cell. Those go to P30
      // or P34 whole, never through a prefix rewrite that would carry a stray
      // character along with it.
      { legacyPatientId: 'p-extension', phone: '0612345678 ext 12', rawData: '{}' },
      { legacyPatientId: 'p-word', phone: 'onbekend', rawData: '{}' },

      // Left alone: no value in the column at all, and an empty cell. There is
      // no number here to give a country code to; an empty phone is P36's.
      { legacyPatientId: 'p-null', phone: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', phone: '', rawData: '{}' },

      // Left alone: a national spelling sitting in other columns entirely. P32
      // tests one column and changes that column (1.1.5), and this row's phone
      // is already international.
      {
        legacyPatientId: 'p-othercolumn',
        phone: '+31612345678',
        bsn: '0612345678',
        weight: '0612345678',
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

  it('proposes the +31 form for every national number', async () => {
    const response = await p32.run(context);

    // The value matters, not just that the rule fired: each `next` is the same
    // number with the trunk zero replaced by `+31`, every remaining digit
    // carried across in order, nothing else added and nothing dropped. One
    // call, every row (1.1.14), and `column` is the column tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-amsterdam',
        column: 'phone',
        prev: '0201234567',
        // A landline reads exactly like a mobile: the zero goes, the rest of
        // the number — area code included — stays where it was.
        next: '+31201234567',
      },
      {
        table: 'patient',
        legacyId: 'p-groningen',
        column: 'phone',
        prev: '0501234567',
        next: '+31501234567',
      },
      {
        table: 'patient',
        legacyId: 'p-mobile',
        column: 'phone',
        prev: '0612345678',
        next: '+31612345678',
      },
      {
        table: 'patient',
        legacyId: 'p-mobile2',
        column: 'phone',
        prev: '0687654321',
        next: '+31687654321',
      },
      {
        table: 'patient',
        legacyId: 'p-rotterdam',
        column: 'phone',
        prev: '0101234567',
        next: '+31101234567',
      },
      {
        table: 'patient',
        legacyId: 'p-service',
        column: 'phone',
        prev: '0900123456',
        next: '+31900123456',
      },
      {
        table: 'patient',
        legacyId: 'p-tooshort',
        column: 'phone',
        prev: '061234567',
        // A digit short of a Dutch number, and the country code is still
        // missing. Saying it is too short is P33's finding, not a reason to
        // leave the number written for a dialler standing in this country.
        next: '+3161234567',
      },
    ]);
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p32.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `phone`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.phone).toBe(update.prev);
    }
  });

  it('never reads an international 00 prefix as a trunk zero', async () => {
    const response = await p32.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // The row the split between P31 and P32 exists for. A Belgian number keeps
    // its own country code: this rule does not propose on it at all, so
    // `+310032475123456` is never put in front of a human.
    expect(touched).not.toContain('p-belgian');
    expect(touched).not.toContain('p-dutchexit');

    for (const update of response.updates) {
      expect(update.prev?.startsWith('00')).toBe(false);
      expect(update.next?.startsWith('+3100')).toBe(false);
    }
  });

  it('leaves international, trunkless, zero-run and uncleaned cells alone', async () => {
    const response = await p32.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A run of zeroes is neither a trunk zero nor a country code.
    expect(touched).not.toContain('p-placeholder');
    expect(touched).not.toContain('p-zeroonly');
    expect(touched).not.toContain('p-zeroes');

    // Already international, whichever country it names.
    expect(touched).not.toContain('p-plus31');
    expect(touched).not.toContain('p-plus32');
    expect(touched).not.toContain('p-plustrunk');

    // No leading zero, so not the national spelling and not a cell to guess a
    // country code onto.
    expect(touched).not.toContain('p-notrunk');
    expect(touched).not.toContain('p-bare31');

    // Grouping or padding still on the cell: P30 cleans it first, and this
    // rule reads what P30 leaves behind.
    expect(touched).not.toContain('p-grouped');
    expect(touched).not.toContain('p-dashes');
    expect(touched).not.toContain('p-padded');

    // Something that is not a digit in the cell.
    expect(touched).not.toContain('p-extension');
    expect(touched).not.toContain('p-word');

    // Nothing in the column to give a country code to.
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
    const response = await p32.run(context);

    // The catalogue does not mark P32 ambiguous: in a Dutch clinic's export a
    // trunk zero is the Dutch national spelling, so writing out the country
    // code it implies is reading the cell rather than guessing at it. The flag
    // is rule-wide (1.1.12), stated once beside the updates, and the `rule` row
    // says the same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p32.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);

      const proposed = update.next ?? '';
      const previous = update.prev ?? '';

      // What was read: bare digits, one trunk zero, and a number after it that
      // does not start with another zero.
      expect(previous).toMatch(/^0[1-9][0-9]*$/);

      // What is proposed: `+31`, then exactly the digits that followed the
      // trunk zero, in the same order. No digit added, dropped or reordered,
      // and nothing of the number itself judged.
      expect(proposed).toMatch(/^\+31[1-9][0-9]*$/);
      expect(proposed).toBe(`+31${previous.slice(1)}`);
      expect(proposed.slice(3)).toBe(previous.slice(1));
      expect(proposed).toHaveLength(previous.length + 2);
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p32.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-mobile');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). What it proposes starts with `+31` rather than a zero, so
    // the rule is self-terminating and the applied row needs no guard to keep
    // it from being re-proposed.
    await patients.update({ legacyPatientId: 'p-mobile' }, { phone: '+31612345678' });

    const after = await p32.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-mobile');

    await patients.update({ legacyPatientId: 'p-mobile' }, { phone: '0612345678' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p32.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(26);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P32 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p32);
    expect(p32.ruleId).toBe('P32');
    expect(p32.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p32.ruleName.length).toBeGreaterThan(0);
    expect(p32.description.length).toBeGreaterThan(0);
  });
});
