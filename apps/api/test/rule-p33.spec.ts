import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p33 } from '../src/rules/catalogue/p33';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P33 — a patient `phone` holding too few or too many digits to be a telephone
 * number, against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 37;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

/**
 * The catalogue's test, written out again here rather than imported from the
 * rule: fifteen digits is E.164's maximum, seven is the shortest complete
 * number in use anywhere, and a cell that names the Netherlands is eleven — the
 * country code and the nine digits a Dutch number has. A test that reused the
 * rule's own constants and regular expressions would agree with it whatever
 * they said.
 */
function isPossiblePhoneLength(value: string): boolean {
  const digits = value.startsWith('+') ? value.slice(1) : value;

  if (value.startsWith('+31')) {
    return digits.length === 11;
  }

  return digits.length >= 7 && digits.length <= 15;
}

describe('P33 — a patient phone with too few or too many digits', () => {
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
      // Too short: a fragment, a number somebody started typing and never
      // finished, a few digits read off a form. Each of these looks like a
      // phone number until the digits are counted.
      { legacyPatientId: 'p-three', phone: '123', rawData: '{}' },
      { legacyPatientId: 'p-five', phone: '61234', rawData: '{}' },
      { legacyPatientId: 'p-six', phone: '612345', rawData: '{}' },

      // Too long: past E.164's fifteen digits, which the numbering plan cannot
      // carry at all — a doubled key, and two numbers pasted into one cell.
      { legacyPatientId: 'p-sixteen', phone: '1234567890123456', rawData: '{}' },
      { legacyPatientId: 'p-twentytwo', phone: '1234567890123456789012', rawData: '{}' },
      { legacyPatientId: 'p-two-numbers', phone: '31612345678031687654321', rawData: '{}' },

      // The same two bounds on an international number: the `+` is notation and
      // is not counted, the country code is.
      { legacyPatientId: 'p-plus-long', phone: '+123456789012345678', rawData: '{}' },
      { legacyPatientId: 'p-plus-short', phone: '+3212', rawData: '{}' },

      // The rows the rest of the phone column hands to this one. Each is what a
      // sibling rule leaves behind, said out loud where each of them says it
      // will be:
      //
      // P30 cleans `+31 (0)6 12345678` to this, keeping the bracketed trunk
      // zero because taking it out would be a second fix. Twelve digits on a
      // number that says +31.
      { legacyPatientId: 'p-plus31trunk', phone: '+310612345678', rawData: '{}' },
      // P32 rewrites `061234567` — a Dutch number a digit short — to this. Ten.
      { legacyPatientId: 'p-plus31short', phone: '+3161234567', rawData: '{}' },
      // P31 rewrites `0031612` to this, carrying every digit across whatever
      // they add up to. Five.
      { legacyPatientId: 'p-plus31exit', phone: '+31612', rawData: '{}' },
      // And a Dutch number with one digit too many in it.
      { legacyPatientId: 'p-plus31long', phone: '+316123456789', rawData: '{}' },

      // Left alone: a Dutch number of exactly the right length — the country
      // code and the nine digits a Dutch number has, mobile or landline.
      { legacyPatientId: 'p-plus31mobile', phone: '+31612345678', rawData: '{}' },
      { legacyPatientId: 'p-plus31landline', phone: '+31201234567', rawData: '{}' },

      // Left alone: another country's number, measured by the universal bounds
      // only. Whether eleven digits is right for Belgium, or thirteen for
      // Germany, is not a question this rule pretends to answer — that would
      // need the table of the world's number plans P31 refused.
      { legacyPatientId: 'p-belgian', phone: '+32475123456', rawData: '{}' },
      { legacyPatientId: 'p-german', phone: '+4930123456789', rawData: '{}' },

      // Left alone: the bounds themselves, which are inclusive. Seven digits is
      // the shortest complete number anywhere and fifteen is E.164's maximum,
      // so neither is too short or too long.
      { legacyPatientId: 'p-seven', phone: '1234567', rawData: '{}' },
      { legacyPatientId: 'p-fifteen', phone: '123456789012345', rawData: '{}' },

      // Left alone: a number with no country code and no trunk zero. Nine and
      // eleven digits are both counts a telephone number has, and what these
      // digits mean is not this rule's question.
      { legacyPatientId: 'p-bare-mobile', phone: '612345678', rawData: '{}' },
      { legacyPatientId: 'p-bare31', phone: '31612345678', rawData: '{}' },

      // Left alone: the trunk zero is P32's fix and the `00` exit prefix is
      // P31's, and both change the count — P32 by writing two digits where one
      // was, P31 by taking two away. These two are the rows that prove the
      // waiting matters: four and five digits as they stand, and neither is
      // counted until the rule that owns the prefix has had its run.
      { legacyPatientId: 'p-national-short', phone: '0123', rawData: '{}' },
      { legacyPatientId: 'p-exit-short', phone: '00312', rawData: '{}' },
      { legacyPatientId: 'p-national', phone: '0612345678', rawData: '{}' },
      { legacyPatientId: 'p-exit', phone: '0031612345678', rawData: '{}' },

      // Left alone: grouping or padding still on the cell. Counting these would
      // be counting the typist's spacing — `12-34` is not a four-digit number
      // yet, it is P30's fix, and this rule reads what P30 leaves behind.
      { legacyPatientId: 'p-grouped', phone: '06 12 34 56 78', rawData: '{}' },
      { legacyPatientId: 'p-dashes-short', phone: '12-34', rawData: '{}' },
      { legacyPatientId: 'p-bracket-trunk', phone: '+31 (0)6 12345678', rawData: '{}' },

      // Left alone: a letter, an extension, a `+` in the middle. Counting an
      // extension as part of the number is exactly the mistake the phone rules
      // were split apart to avoid; these are P30's and P34's as they stand.
      { legacyPatientId: 'p-extension', phone: '0612345678 ext 12', rawData: '{}' },
      { legacyPatientId: 'p-word', phone: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-plus-middle', phone: '06+31612345678', rawData: '{}' },

      // Left alone: one digit repeated, which the catalogue gives P35 in as
      // many words. `p-ones` is the row that matters here — sixteen digits, so
      // too long by the count, and still not counted, because what is wrong
      // with it is that nobody typed a number at all.
      { legacyPatientId: 'p-placeholder', phone: '000000000', rawData: '{}' },
      { legacyPatientId: 'p-ones', phone: '1111111111111111', rawData: '{}' },
      { legacyPatientId: 'p-zero', phone: '0', rawData: '{}' },

      // Left alone: no value in the column at all, and an empty cell. There are
      // no digits here to count, and an empty phone is P36's finding.
      { legacyPatientId: 'p-null', phone: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', phone: '', rawData: '{}' },

      // Left alone: impossible counts sitting in other columns entirely. P33
      // tests one column and reports against that column (1.1.5), and this
      // row's phone is eleven digits with a +31 on the front.
      {
        legacyPatientId: 'p-othercolumn',
        phone: '+31612345678',
        bsn: '123',
        weight: '1234567890123456',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // phone here is the right length.
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

  it('reports every phone whose digits cannot be a phone number, and nothing else', async () => {
    const response = await p33.run(context);

    // One call, every row (1.1.14). `prev` is the cell verbatim so the human
    // can count the digits for themselves, `next` is null throughout (1.1.12),
    // and `column` is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      { table: 'patient', legacyId: 'p-five', column: 'phone', prev: '61234', next: null },
      {
        table: 'patient',
        legacyId: 'p-plus-long',
        column: 'phone',
        prev: '+123456789012345678',
        next: null,
      },
      { table: 'patient', legacyId: 'p-plus-short', column: 'phone', prev: '+3212', next: null },
      { table: 'patient', legacyId: 'p-plus31exit', column: 'phone', prev: '+31612', next: null },
      {
        table: 'patient',
        legacyId: 'p-plus31long',
        column: 'phone',
        prev: '+316123456789',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-plus31short',
        column: 'phone',
        prev: '+3161234567',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-plus31trunk',
        column: 'phone',
        prev: '+310612345678',
        next: null,
      },
      { table: 'patient', legacyId: 'p-six', column: 'phone', prev: '612345', next: null },
      {
        table: 'patient',
        legacyId: 'p-sixteen',
        column: 'phone',
        prev: '1234567890123456',
        next: null,
      },
      { table: 'patient', legacyId: 'p-three', column: 'phone', prev: '123', next: null },
      {
        table: 'patient',
        legacyId: 'p-twentytwo',
        column: 'phone',
        prev: '1234567890123456789012',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-two-numbers',
        column: 'phone',
        prev: '31612345678031687654321',
        next: null,
      },
    ]);
  });

  it('is the catalogue test — a count no telephone number has', async () => {
    const response = await p33.run(context);

    // Every reported cell, measured against the test written independently of
    // the rule: under seven digits or over fifteen, or a +31 number that is not
    // eleven.
    for (const update of response.updates) {
      expect(isPossiblePhoneLength(update.prev ?? '')).toBe(false);
    }

    // And the other side of it: every fixture the rule walked past is a cell
    // with nothing in it, a cell that is not yet bare digits, a prefix another
    // rule rewrites first, one digit repeated, or a count a phone number can
    // have. Nothing impossible was missed.
    const touched = new Set(response.updates.map((update) => update.legacyId));
    const stored = await patients.find();

    for (const patient of stored) {
      const value = patient.phone;

      if (touched.has(patient.legacyPatientId) || value === null || value.length === 0) {
        continue;
      }

      const notYetCountable = !/^\+?[0-9]+$/.test(value);
      const rewrittenFirst = /^00[1-9]/.test(value) || /^0[1-9]/.test(value);
      const oneDigitRepeated = /^\+?([0-9])\1*$/.test(value);

      expect(
        notYetCountable || rewrittenFirst || oneDigitRepeated || isPossiblePhoneLength(value),
      ).toBe(true);
    }
  });

  it('catches the lengths the other phone rules hand it', async () => {
    const response = await p33.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // P30 keeps the bracketed trunk zero, P31 carries every digit across its
    // prefix rewrite, and P32 writes +31 onto a number a digit short. All three
    // say in as many words that the length is this rule's finding, and all
    // three rows arrive here — otherwise a number nobody can dial migrates
    // with no rule having said so.
    expect(touched).toContain('p-plus31trunk');
    expect(touched).toContain('p-plus31exit');
    expect(touched).toContain('p-plus31short');

    // And a Dutch number is eleven digits either side: one too many is as
    // undialable as one too few.
    expect(touched).toContain('p-plus31long');
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p33.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `phone`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.phone).toBe(update.prev);
    }
  });

  it('leaves counts a phone number can have alone', async () => {
    const response = await p33.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A Dutch number of exactly the right length, mobile or landline.
    expect(touched).not.toContain('p-plus31mobile');
    expect(touched).not.toContain('p-plus31landline');

    // Another country's number, measured by the universal bounds only.
    expect(touched).not.toContain('p-belgian');
    expect(touched).not.toContain('p-german');

    // The bounds are inclusive at both ends.
    expect(touched).not.toContain('p-seven');
    expect(touched).not.toContain('p-fifteen');

    // A number with no country code on it at all. What the digits mean is not
    // this rule's question — only how many of them there are.
    expect(touched).not.toContain('p-bare-mobile');
    expect(touched).not.toContain('p-bare31');
  });

  it('leaves the cells the other phone rules own alone', async () => {
    const response = await p33.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A prefix another rule rewrites changes the count, so the count is not
    // settled yet. These two are impossible lengths as they stand and are still
    // not reported, which is the whole point of waiting.
    expect(touched).not.toContain('p-national-short');
    expect(touched).not.toContain('p-exit-short');
    expect(touched).not.toContain('p-national');
    expect(touched).not.toContain('p-exit');

    // Grouping or padding still on the cell: P30 cleans it first, and counting
    // the typist's spacing would be counting the wrong thing.
    expect(touched).not.toContain('p-grouped');
    expect(touched).not.toContain('p-dashes-short');
    expect(touched).not.toContain('p-bracket-trunk');

    // A letter, an extension, a `+` in the middle — P30's and P34's, never
    // counted as though the extension were part of the number.
    expect(touched).not.toContain('p-extension');
    expect(touched).not.toContain('p-word');
    expect(touched).not.toContain('p-plus-middle');

    // One digit repeated is P35's placeholder, whether it is nine digits long
    // or sixteen. Reporting `p-ones` here as well would put two ambiguous
    // findings on one cell in one batch (1.1.4).
    expect(touched).not.toContain('p-placeholder');
    expect(touched).not.toContain('p-ones');
    expect(touched).not.toContain('p-zero');

    // Nothing in the column to count.
    expect(touched).not.toContain('p-null');
    expect(touched).not.toContain('p-empty');

    // And no other column is reported against, whatever its length (1.1.5) —
    // including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-othercolumn');
    expect(touched).not.toContain(' p-paddedid ');
    for (const update of response.updates) {
      expect(update.column).toBe('phone');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p33.run(context);

    // The catalogue marks P33 ambiguous: the missing digits are not in the cell
    // and the extra ones cannot be told from the real ones, so any proposal
    // would be an invented number — and an invented number of the right length
    // rings on somebody else's handset. The flag is rule-wide (1.1.12), stated
    // once beside the updates, and the `rule` row says the same thing the
    // response does, which is what makes the description the human's only
    // explanation.
    expect(response.ambiguity).toBe(true);
    expect(p33.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p33]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P33', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once the whole number is in the cell, or the cell is cleared', async () => {
    const before = await p33.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-three');
    expect(before.updates.map((update) => update.legacyId)).toContain('p-plus31trunk');

    // What resolving an ambiguous finding does: a human writes the whole number
    // into the column the rule tested (1.1.5), or — where there never was one —
    // takes the text out, which is then P36's ordinary empty finding rather
    // than this one. The rule is self-terminating either way, because it tests
    // what it reports on.
    await patients.update({ legacyPatientId: 'p-three' }, { phone: '+31612345678' });
    await patients.update({ legacyPatientId: 'p-plus31trunk' }, { phone: null });

    const after = await p33.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-three');
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-plus31trunk');

    await patients.update({ legacyPatientId: 'p-three' }, { phone: '123' });
    await patients.update({ legacyPatientId: 'p-plus31trunk' }, { phone: '+310612345678' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p33.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — a cell quietly padded or trimmed to the right length most of all.
    expect(before).toHaveLength(FIXTURE_ROWS);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P33 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p33);
    expect(p33.ruleId).toBe('P33');
    expect(p33.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), and
    // for an ambiguous rule it is the whole explanation, since there is no
    // proposed value to show.
    expect(p33.ruleName.length).toBeGreaterThan(0);
    expect(p33.description.length).toBeGreaterThan(0);
  });
});
