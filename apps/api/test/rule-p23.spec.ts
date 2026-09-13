import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p23 } from '../src/rules/catalogue/p23';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P23 — a patient `sex` written in one of the spellings this export uses, where
 * that spelling is not the canonical `M` or `F`, against a real database with
 * real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P23 — a recognised spelling of a patient sex, made canonical', () => {
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
      // The male spellings the catalogue names, and the case variants of each —
      // the English word, the Dutch word, and the letter the two share.
      { legacyPatientId: 'p-malelower', sex: 'male', rawData: '{}' },
      { legacyPatientId: 'p-maletitle', sex: 'Male', rawData: '{}' },
      { legacyPatientId: 'p-maleupper', sex: 'MALE', rawData: '{}' },
      { legacyPatientId: 'p-mlower', sex: 'm', rawData: '{}' },
      { legacyPatientId: 'p-man', sex: 'man', rawData: '{}' },
      { legacyPatientId: 'p-mantitle', sex: 'Man', rawData: '{}' },
      { legacyPatientId: 'p-manupper', sex: 'MAN', rawData: '{}' },

      // The female spellings, in both languages and both abbreviations.
      { legacyPatientId: 'p-femalelower', sex: 'female', rawData: '{}' },
      { legacyPatientId: 'p-femaletitle', sex: 'Female', rawData: '{}' },
      { legacyPatientId: 'p-femaleupper', sex: 'FEMALE', rawData: '{}' },
      { legacyPatientId: 'p-flower', sex: 'f', rawData: '{}' },
      { legacyPatientId: 'p-vupper', sex: 'V', rawData: '{}' },
      { legacyPatientId: 'p-vlower', sex: 'v', rawData: '{}' },
      { legacyPatientId: 'p-vrouw', sex: 'vrouw', rawData: '{}' },
      { legacyPatientId: 'p-vrouwtitle', sex: 'Vrouw', rawData: '{}' },

      // Padded cells. This column has no whitespace rule of its own, so a
      // padded spelling is this rule's — and the whole cell becomes the
      // canonical value, padding and all, because the fix is the answer
      // rewritten rather than a piece of the old spelling edited.
      { legacyPatientId: 'p-paddedmale', sex: '  Male  ', rawData: '{}' },
      { legacyPatientId: 'p-paddedm', sex: ' M ', rawData: '{}' },
      { legacyPatientId: 'p-paddedf', sex: ' F ', rawData: '{}' },
      { legacyPatientId: 'p-tabvrouw', sex: '\tvrouw', rawData: '{}' },

      // Left alone: already exactly what this rule produces, so there is
      // nothing to propose and nothing for a human to approve.
      { legacyPatientId: 'p-canonicalmale', sex: 'M', rawData: '{}' },
      { legacyPatientId: 'p-canonicalfemale', sex: 'F', rawData: '{}' },

      // Left alone: a value nobody recognises, which is P24's finding. Some of
      // these plainly mean something and some plainly mean nothing; telling
      // those apart is a human's call, not a lookup.
      { legacyPatientId: 'p-unknownword', sex: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-unknownletter', sex: 'X', rawData: '{}' },
      { legacyPatientId: 'p-unknownother', sex: 'other', rawData: '{}' },
      { legacyPatientId: 'p-unknownone', sex: '1', rawData: '{}' },
      { legacyPatientId: 'p-unknownzero', sex: '0', rawData: '{}' },
      { legacyPatientId: 'p-nonbinary', sex: 'non-binary', rawData: '{}' },
      { legacyPatientId: 'p-abbreviated', sex: 'M.', rawData: '{}' },
      { legacyPatientId: 'p-bothslash', sex: 'M/F', rawData: '{}' },
      { legacyPatientId: 'p-bothcomma', sex: 'm, f', rawData: '{}' },

      // Left alone, and these are the rows that matter most: the match is on
      // the whole cell, so `woman` is not read as `man` and `mannelijk` and
      // `vrouwelijk` are not read as the words they start with.
      { legacyPatientId: 'p-woman', sex: 'woman', rawData: '{}' },
      { legacyPatientId: 'p-mannelijk', sex: 'mannelijk', rawData: '{}' },
      { legacyPatientId: 'p-vrouwelijk', sex: 'vrouwelijk', rawData: '{}' },

      // Left alone: no value in the column at all, which is P25's finding — a
      // cell of spaces included, since it trims to nothing.
      { legacyPatientId: 'p-empty', sex: '', rawData: '{}' },
      { legacyPatientId: 'p-blank', sex: '   ', rawData: '{}' },
      { legacyPatientId: 'p-null', sex: null, rawData: '{}' },

      // Left alone: a sex spelled into other columns entirely. P23 tests one
      // column (1.1.5) and this row's sex is already canonical.
      {
        legacyPatientId: 'p-othercolumn',
        sex: 'M',
        fullName: 'male',
        dob: 'vrouw',
        status: 'female',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // sex here is already canonical.
      { legacyPatientId: ' p-paddedid ', sex: 'F', rawData: '{}' },
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

  it('proposes the canonical value for every recognised spelling', async () => {
    const response = await p23.run(context);

    // The value matters, not just that the rule fired: each `next` is the
    // canonical code for the answer the cell already gave — `M` for the male
    // spellings, `F` for the female ones, whichever language and whichever
    // capitals the cell used. One call, every row (1.1.14), and `column` is the
    // column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-femalelower',
        column: 'sex',
        prev: 'female',
        next: 'F',
      },
      {
        table: 'patient',
        legacyId: 'p-femaletitle',
        column: 'sex',
        prev: 'Female',
        next: 'F',
      },
      {
        table: 'patient',
        legacyId: 'p-femaleupper',
        column: 'sex',
        prev: 'FEMALE',
        next: 'F',
      },
      {
        table: 'patient',
        legacyId: 'p-flower',
        column: 'sex',
        prev: 'f',
        // Case alone is a form of the same spelling, so the lower-case letter
        // is canonicalised like the words are.
        next: 'F',
      },
      {
        table: 'patient',
        legacyId: 'p-malelower',
        column: 'sex',
        prev: 'male',
        next: 'M',
      },
      {
        table: 'patient',
        legacyId: 'p-maletitle',
        column: 'sex',
        prev: 'Male',
        next: 'M',
      },
      {
        table: 'patient',
        legacyId: 'p-maleupper',
        column: 'sex',
        prev: 'MALE',
        next: 'M',
      },
      {
        table: 'patient',
        legacyId: 'p-man',
        column: 'sex',
        prev: 'man',
        // The Dutch word, which means exactly what the English one does.
        next: 'M',
      },
      {
        table: 'patient',
        legacyId: 'p-mantitle',
        column: 'sex',
        prev: 'Man',
        next: 'M',
      },
      {
        table: 'patient',
        legacyId: 'p-manupper',
        column: 'sex',
        prev: 'MAN',
        next: 'M',
      },
      {
        table: 'patient',
        legacyId: 'p-mlower',
        column: 'sex',
        prev: 'm',
        next: 'M',
      },
      {
        table: 'patient',
        legacyId: 'p-paddedf',
        column: 'sex',
        prev: ' F ',
        // The padding is part of the spelling being replaced: the whole cell
        // becomes the canonical value.
        next: 'F',
      },
      {
        table: 'patient',
        legacyId: 'p-paddedm',
        column: 'sex',
        prev: ' M ',
        next: 'M',
      },
      {
        table: 'patient',
        legacyId: 'p-paddedmale',
        column: 'sex',
        prev: '  Male  ',
        next: 'M',
      },
      {
        table: 'patient',
        legacyId: 'p-tabvrouw',
        column: 'sex',
        prev: '\tvrouw',
        next: 'F',
      },
      {
        table: 'patient',
        legacyId: 'p-vlower',
        column: 'sex',
        prev: 'v',
        next: 'F',
      },
      {
        table: 'patient',
        legacyId: 'p-vrouw',
        column: 'sex',
        prev: 'vrouw',
        // The Dutch word and the Dutch letter both become `F`: the canonical
        // pair is one alphabet, not one letter from each language.
        next: 'F',
      },
      {
        table: 'patient',
        legacyId: 'p-vrouwtitle',
        column: 'sex',
        prev: 'Vrouw',
        next: 'F',
      },
      {
        table: 'patient',
        legacyId: 'p-vupper',
        column: 'sex',
        prev: 'V',
        next: 'F',
      },
    ]);
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p23.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `sex`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.sex).toBe(update.prev);
    }
  });

  it('leaves canonical values, unrecognised values and every other cell alone', async () => {
    const response = await p23.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Already what this rule produces, so there is nothing to propose.
    expect(touched).not.toContain('p-canonicalmale');
    expect(touched).not.toContain('p-canonicalfemale');

    // A value nobody recognises is P24's finding, reported whole and asked
    // about rather than guessed at here.
    expect(touched).not.toContain('p-unknownword');
    expect(touched).not.toContain('p-unknownletter');
    expect(touched).not.toContain('p-unknownother');
    expect(touched).not.toContain('p-unknownone');
    expect(touched).not.toContain('p-unknownzero');
    expect(touched).not.toContain('p-nonbinary');
    expect(touched).not.toContain('p-abbreviated');
    expect(touched).not.toContain('p-bothslash');
    expect(touched).not.toContain('p-bothcomma');

    // The match is on the whole cell and never on part of one: a rule that
    // looked inside cells would read `woman` as `man` and propose `M` for a
    // woman, which is the worst thing this rule could do.
    expect(touched).not.toContain('p-woman');
    expect(touched).not.toContain('p-mannelijk');
    expect(touched).not.toContain('p-vrouwelijk');

    // No value in the column at all, which is P25's finding.
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-null');

    // And no other column is proposed against, whatever it holds (1.1.5) —
    // including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-othercolumn');
    expect(touched).not.toContain(' p-paddedid ');
    for (const update of response.updates) {
      expect(update.column).toBe('sex');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries the canonical value', async () => {
    const response = await p23.run(context);

    // The catalogue does not mark P23 ambiguous: each recognised spelling says
    // one thing and only one thing, so the rule reads it rather than guessing.
    // The flag is rule-wide (1.1.12), stated once beside the updates, and the
    // `rule` row says the same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p23.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    const male = new Set(['m', 'male', 'man']);
    const female = new Set(['f', 'female', 'v', 'vrouw']);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      // Never a proposal with nothing in it: a row already holding the
      // canonical value is walked past rather than reported unchanged.
      expect(update.next).not.toBe(update.prev);

      const proposed = update.next ?? '';
      const spelling = (update.prev ?? '').trim().toLowerCase();

      // Two values and no third, and each names the sex the cell already gave.
      expect(['M', 'F']).toContain(proposed);
      expect(proposed).toBe(male.has(spelling) ? 'M' : 'F');
      expect(male.has(spelling) || female.has(spelling)).toBe(true);
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p23.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-malelower');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). The canonical value is what this rule produces, so the
    // rule is self-terminating and the applied row needs no guard to keep it
    // from being re-proposed.
    await patients.update({ legacyPatientId: 'p-malelower' }, { sex: 'M' });

    const after = await p23.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-malelower');

    await patients.update({ legacyPatientId: 'p-malelower' }, { sex: 'male' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p23.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(38);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P23 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p23);
    expect(p23.ruleId).toBe('P23');
    expect(p23.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p23.ruleName.length).toBeGreaterThan(0);
    expect(p23.description.length).toBeGreaterThan(0);
  });
});
