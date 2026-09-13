import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p28 } from '../src/rules/catalogue/p28';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P28 — a patient `bsn` of nine digits that fails the Dutch eleven-proef,
 * against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 27;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

/**
 * The eleven-proef, written out again here rather than imported from the rule.
 *
 * A test that reused the rule's own arithmetic would agree with it whatever it
 * computed. This is the check stated independently — first eight digits weighted
 * 9 down to 2, the ninth weighted −1, total divisible by eleven — so the
 * assertions below measure the rule rather than echo it.
 */
function elevenProefTotal(digits: string): number {
  const weights = [9, 8, 7, 6, 5, 4, 3, 2, -1];

  return weights.reduce((total, weight, position) => total + weight * Number(digits[position]), 0);
}

describe('P28 — a patient bsn that fails the eleven-proef', () => {
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
      // What the rule is for: nine digits, the right shape, and a total that
      // does not divide by eleven.
      { legacyPatientId: 'p-fail-typo', bsn: '123456789', rawData: '{}' },
      // One digit away from `111222333`, which passes — the single mistyped
      // digit the check exists to catch.
      { legacyPatientId: 'p-fail-transposed', bsn: '111222334', rawData: '{}' },
      // What P27 hands on once it has put the eaten zero back: a nine-digit
      // number this rule is the first thing ever to check.
      { legacyPatientId: 'p-fail-leadingzero', bsn: '067077086', rawData: '{}' },
      // Nine digits somebody typed to get past a required field.
      { legacyPatientId: 'p-fail-repeated', bsn: '999999999', rawData: '{}' },
      { legacyPatientId: 'p-fail-sequence', bsn: '987654321', rawData: '{}' },
      // Leading zeros are digits like any other, and the sum is done on the
      // digits as written — never on the cell read as a number.
      { legacyPatientId: 'p-fail-onedigit', bsn: '000000001', rawData: '{}' },
      { legacyPatientId: 'p-fail-padzero', bsn: '012345678', rawData: '{}' },

      // Left alone: nine digits whose total divides by eleven. Nothing to say.
      { legacyPatientId: 'p-pass', bsn: '111222333', rawData: '{}' },
      { legacyPatientId: 'p-pass-other', bsn: '123456782', rawData: '{}' },
      { legacyPatientId: 'p-pass-leadingzero', bsn: '067077080', rawData: '{}' },
      { legacyPatientId: 'p-pass-onedigit', bsn: '100000009', rawData: '{}' },
      { legacyPatientId: 'p-pass-nines', bsn: '111111110', rawData: '{}' },
      // Passes the arithmetic, so this rule walks past it. The catalogue's
      // entry is the eleven-proef, and a register's other reasons to refuse a
      // number are not this rule's question (1.1.4).
      { legacyPatientId: 'p-pass-zeros', bsn: '000000000', rawData: '{}' },

      // Left alone: eight digits are P27's to pad first, and the sum on eight
      // digits is the sum on a different number.
      { legacyPatientId: 'p-eight', bsn: '67077086', rawData: '{}' },

      // Left alone: any other length has no eleven-proef to fail. P29 reports
      // the wrong length after cleaning.
      { legacyPatientId: 'p-seven', bsn: '1234567', rawData: '{}' },
      { legacyPatientId: 'p-ten', bsn: '1234567890', rawData: '{}' },

      // Left alone: nine digits under punctuation or padding, which is P26's
      // fix first. Each of these strips to `123456789`, which fails the check —
      // so a rule that cleaned the cell itself would report them, and this one
      // must not. One rule, one fix (1.1.4).
      { legacyPatientId: 'p-grouped', bsn: '123 456 789', rawData: '{}' },
      { legacyPatientId: 'p-dotted', bsn: '123.456.789', rawData: '{}' },
      { legacyPatientId: 'p-dashed', bsn: '1234-56-789', rawData: '{}' },
      { legacyPatientId: 'p-padded', bsn: '  123456789  ', rawData: '{}' },

      // Left alone: a letter or a word in the cell. There is no sum to do, and
      // P29 reports these whole.
      { legacyPatientId: 'p-letter', bsn: '1234X6789', rawData: '{}' },
      { legacyPatientId: 'p-word', bsn: 'onbekend', rawData: '{}' },

      // Left alone: no digits at all. An absent BSN is not a failed checksum.
      { legacyPatientId: 'p-null', bsn: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', bsn: '', rawData: '{}' },
      { legacyPatientId: 'p-blank', bsn: '        ', rawData: '{}' },

      // Left alone: failing nine-digit numbers sitting in other columns
      // entirely. P28 tests one column (1.1.5), and this row's bsn passes.
      {
        legacyPatientId: 'p-othercolumn',
        bsn: '111222333',
        phone: '123456789',
        dob: '987654321',
        weight: '999999999',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // bsn here passes the check.
      { legacyPatientId: ' p-paddedid ', bsn: '111222333', rawData: '{}' },
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

  it('reports every nine-digit bsn that fails the check, and nothing else', async () => {
    const response = await p28.run(context);

    // One call, every row (1.1.14). `prev` is the cell verbatim so the human
    // sees the nine digits the row holds, `next` is null throughout (1.1.12),
    // and `column` is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-fail-leadingzero',
        column: 'bsn',
        prev: '067077086',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-fail-onedigit',
        column: 'bsn',
        prev: '000000001',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-fail-padzero',
        column: 'bsn',
        prev: '012345678',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-fail-repeated',
        column: 'bsn',
        prev: '999999999',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-fail-sequence',
        column: 'bsn',
        prev: '987654321',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-fail-transposed',
        column: 'bsn',
        prev: '111222334',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-fail-typo',
        column: 'bsn',
        prev: '123456789',
        next: null,
      },
    ]);
  });

  it('is the eleven-proef and not some other test of the digits', async () => {
    const response = await p28.run(context);

    // The arithmetic itself, checked against a statement of it written
    // independently of the rule: every reported cell is nine digits whose
    // weighted total does not divide by eleven.
    for (const update of response.updates) {
      const digits = update.prev ?? '';
      expect(digits).toMatch(/^[0-9]{9}$/);
      expect(elevenProefTotal(digits) % 11).not.toBe(0);
    }

    // And the other side of it: every nine-digit fixture the rule walked past
    // is one whose total does divide by eleven, so nothing valid was reported
    // and nothing failing was missed.
    const touched = new Set(response.updates.map((update) => update.legacyId));
    const stored = await patients.find();

    for (const patient of stored) {
      const digits = patient.bsn ?? '';

      if (!/^[0-9]{9}$/.test(digits)) {
        continue;
      }

      expect(touched.has(patient.legacyPatientId)).toBe(elevenProefTotal(digits) % 11 !== 0);
    }
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p28.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `bsn`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.bsn).toBe(update.prev);
    }
  });

  it('leaves valid numbers, other shapes and every other column alone', async () => {
    const response = await p28.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A number that satisfies the check, including one that is all zeros: the
    // catalogue's entry is the eleven-proef, and that sum is zero.
    expect(touched).not.toContain('p-pass');
    expect(touched).not.toContain('p-pass-other');
    expect(touched).not.toContain('p-pass-leadingzero');
    expect(touched).not.toContain('p-pass-onedigit');
    expect(touched).not.toContain('p-pass-nines');
    expect(touched).not.toContain('p-pass-zeros');

    // Eight digits are P27's to pad first, and any other length is P29's.
    expect(touched).not.toContain('p-eight');
    expect(touched).not.toContain('p-seven');
    expect(touched).not.toContain('p-ten');

    // Nine digits under punctuation or padding: P26 cleans the cell first, and
    // this rule reads the cleaned value on the next run. Each of these strips
    // to a number that fails, so this is what proves the rule never strips.
    expect(touched).not.toContain('p-grouped');
    expect(touched).not.toContain('p-dotted');
    expect(touched).not.toContain('p-dashed');
    expect(touched).not.toContain('p-padded');

    // A letter or a word: no sum to do, and P29 reports these whole.
    expect(touched).not.toContain('p-letter');
    expect(touched).not.toContain('p-word');

    // No digits at all.
    expect(touched).not.toContain('p-null');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-blank');

    // And no other column is reported against, however badly its digits fail
    // (1.1.5) — including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-othercolumn');
    expect(touched).not.toContain(' p-paddedid ');
    for (const update of response.updates) {
      expect(update.column).toBe('bsn');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p28.run(context);

    // The catalogue marks P28 ambiguous: the sum says a number is wrong and
    // never what the right one is, and a number this rule invented would either
    // fail the same check or belong to somebody else. The flag is rule-wide
    // (1.1.12) — stated once beside the updates — and the `rule` row says the
    // same thing the response does, which is what makes the description the
    // human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p28.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p28]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P28', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once the real number is in the cell', async () => {
    const before = await p28.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-fail-typo');

    // What resolving an ambiguous finding does: a human finds the real number
    // and writes it into the column the rule tested (1.1.5). The rule is
    // self-terminating — it tests what it reports on, so the row does not come
    // back.
    await patients.update({ legacyPatientId: 'p-fail-typo' }, { bsn: '123456782' });

    const after = await p28.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-fail-typo');

    await patients.update({ legacyPatientId: 'p-fail-typo' }, { bsn: '123456789' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p28.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — a BSN quietly "corrected" to something that passes most of all.
    expect(before).toHaveLength(FIXTURE_ROWS);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P28 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p28);
    expect(p28.ruleId).toBe('P28');
    expect(p28.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), and
    // for an ambiguous rule it is the whole explanation, since there is no
    // proposed value to show.
    expect(p28.ruleName.length).toBeGreaterThan(0);
    expect(p28.description.length).toBeGreaterThan(0);
  });
});
