import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p27 } from '../src/rules/catalogue/p27';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P27 — a patient `bsn` holding eight digits, which is a nine-digit BSN whose
 * leading zero a spreadsheet ate, against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P27 — a patient bsn of eight digits, missing its leading zero', () => {
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
      // Eight digits and nothing else: a nine-digit BSN that went through
      // something reading it as a number, which has no leading zero to keep.
      { legacyPatientId: 'p-eight', bsn: '67077086', rawData: '{}' },
      { legacyPatientId: 'p-eightother', bsn: '12345678', rawData: '{}' },

      // Eight digits that already start with a zero. Eight is eight: the fix is
      // the length, and a cell one digit short gets one digit back.
      { legacyPatientId: 'p-eightstartzero', bsn: '07077086', rawData: '{}' },

      // Eight digits that spell nothing a register would accept. Whether the
      // restored number passes the eleven-proef is P28's question, not this
      // rule's — this rule counts digits.
      { legacyPatientId: 'p-eightzeros', bsn: '00000000', rawData: '{}' },

      // Left alone: nine digits is the length a BSN is, including one whose
      // leading zero survived the export intact.
      { legacyPatientId: 'p-nine', bsn: '123456789', rawData: '{}' },
      { legacyPatientId: 'p-ninezero', bsn: '067077086', rawData: '{}' },

      // Left alone: a length that is neither eight nor nine. Seven digits is
      // not padded with two zeros — one lost digit does not explain it, and the
      // wrong length after cleaning is P29's finding.
      { legacyPatientId: 'p-seven', bsn: '1234567', rawData: '{}' },
      { legacyPatientId: 'p-ten', bsn: '1234567890', rawData: '{}' },
      { legacyPatientId: 'p-onedigit', bsn: '0', rawData: '{}' },

      // Left alone: no digits at all to count. Eight spaces is eight
      // characters, which is not the same thing as eight digits.
      { legacyPatientId: 'p-null', bsn: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', bsn: '', rawData: '{}' },
      { legacyPatientId: 'p-blank', bsn: '        ', rawData: '{}' },

      // Left alone: eight digits under punctuation or padding, which is P26's
      // fix first. P26 proposes the digits alone, and this rule reads that on
      // the next run — one rule, one fix (1.1.4), and never two proposals on
      // one cell in one batch.
      { legacyPatientId: 'p-grouped', bsn: '1234-5678', rawData: '{}' },
      { legacyPatientId: 'p-padded', bsn: '  12345678  ', rawData: '{}' },
      { legacyPatientId: 'p-innerspace', bsn: '1234 5678', rawData: '{}' },

      // Left alone: a letter or a stray mark in the cell. This rule never
      // strips and never reads around what is there — P29 reports these whole.
      { legacyPatientId: 'p-letter', bsn: '1234X678', rawData: '{}' },
      { legacyPatientId: 'p-word', bsn: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-trailingcomma', bsn: '12345678,', rawData: '{}' },
      { legacyPatientId: 'p-plus', bsn: '+1234567', rawData: '{}' },

      // Left alone: eight digits sitting in other columns entirely. P27 tests
      // one column (1.1.5), and this row's bsn is the length a BSN is.
      {
        legacyPatientId: 'p-othercolumn',
        bsn: '123456789',
        phone: '06123456',
        weight: '82345678',
        dob: '12345678',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // bsn here is nine digits already.
      { legacyPatientId: ' p-paddedid ', bsn: '123456789', rawData: '{}' },
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

  it('proposes the zero-padded number for every eight-digit bsn', async () => {
    const response = await p27.run(context);

    // The value matters, not just that the rule fired: each `next` is the same
    // eight digits in the same order with one zero on the front, making the
    // nine digits a BSN has. One call, every row (1.1.14), and `column` is the
    // column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-eight',
        column: 'bsn',
        prev: '67077086',
        next: '067077086',
      },
      {
        table: 'patient',
        legacyId: 'p-eightother',
        column: 'bsn',
        prev: '12345678',
        next: '012345678',
      },
      {
        table: 'patient',
        legacyId: 'p-eightstartzero',
        column: 'bsn',
        prev: '07077086',
        // Eight digits is eight digits, whatever the first one is.
        next: '007077086',
      },
      {
        table: 'patient',
        legacyId: 'p-eightzeros',
        column: 'bsn',
        prev: '00000000',
        // Padded like any other eight digits. Whether this is a number a
        // register would accept is P28's question.
        next: '000000000',
      },
    ]);
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p27.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `bsn`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.bsn).toBe(update.prev);
    }
  });

  it('leaves other lengths, grouped cells, letters and every other column alone', async () => {
    const response = await p27.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Nine digits is the length a BSN is, so there is nothing to propose.
    expect(touched).not.toContain('p-nine');
    expect(touched).not.toContain('p-ninezero');

    // Neither eight nor nine: not this rule's fix, and never padded twice.
    expect(touched).not.toContain('p-seven');
    expect(touched).not.toContain('p-ten');
    expect(touched).not.toContain('p-onedigit');

    // No digits to count at all.
    expect(touched).not.toContain('p-null');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-blank');

    // Eight digits under punctuation or padding: P26 cleans the cell first, and
    // this rule reads the cleaned value on the next run.
    expect(touched).not.toContain('p-grouped');
    expect(touched).not.toContain('p-padded');
    expect(touched).not.toContain('p-innerspace');

    // A letter or a stray mark: reported whole by P29, not repaired here.
    expect(touched).not.toContain('p-letter');
    expect(touched).not.toContain('p-word');
    expect(touched).not.toContain('p-trailingcomma');
    expect(touched).not.toContain('p-plus');

    // And no other column is proposed against, however many digits it holds
    // (1.1.5) — including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-othercolumn');
    expect(touched).not.toContain(' p-paddedid ');
    for (const update of response.updates) {
      expect(update.column).toBe('bsn');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding restores exactly one leading zero', async () => {
    const response = await p27.run(context);

    // The catalogue does not mark P27 ambiguous: the missing digit is not
    // guessed, it is the only digit a number can lose silently off its front.
    // The flag is rule-wide (1.1.12), stated once beside the updates, and the
    // `rule` row says the same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p27.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);

      const proposed = update.next ?? '';
      const previous = update.prev ?? '';

      // Eight digits in, nine digits out, one zero added at the front and
      // nothing else touched: the digits that were there are still there, in
      // the order they were in.
      expect(previous).toMatch(/^[0-9]{8}$/);
      expect(proposed).toMatch(/^0[0-9]{8}$/);
      expect(proposed).toHaveLength(9);
      expect(proposed).toBe(`0${previous}`);
      expect(proposed.slice(1)).toBe(previous);
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p27.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-eight');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). What it proposes is nine digits, so the rule is
    // self-terminating and the applied row needs no guard to keep it from being
    // re-proposed.
    await patients.update({ legacyPatientId: 'p-eight' }, { bsn: '067077086' });

    const after = await p27.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-eight');

    await patients.update({ legacyPatientId: 'p-eight' }, { bsn: '67077086' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p27.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(21);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P27 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p27);
    expect(p27.ruleId).toBe('P27');
    expect(p27.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p27.ruleName.length).toBeGreaterThan(0);
    expect(p27.description.length).toBeGreaterThan(0);
  });
});
