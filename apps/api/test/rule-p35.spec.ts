import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p35 } from '../src/rules/catalogue/p35';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P35 — a patient `phone` holding a placeholder rather than a number, against a
 * real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 32;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

/**
 * The keypad written out twice, in both directions, so that any run along it —
 * including one that carries on past the last key onto the first — appears as
 * an ordinary substring.
 */
const PAD_ASCENDING = '01234567890123456789';
const PAD_DESCENDING = '98765432109876543210';

/**
 * The catalogue's test, written out again here rather than imported from the
 * rule. A test that reused the rule's own regexes and arithmetic would agree
 * with them whatever they said, so this asks the same question a different way:
 * "all one digit" is a cell with exactly one distinct character in it, and "the
 * keypad run straight through" is a cell that can be found, whole, inside the
 * pad written out twice — no stepping, no modular arithmetic, no backreference.
 *
 * The two bounds are stated here as well, because they are part of what the
 * rule claims: a run passes each of the ten keys at most once, and a cell
 * shorter than the shortest telephone number in use anywhere is a fragment
 * rather than a stand-in for a number.
 */
function isPlaceholder(value: string): boolean {
  const digits = value.startsWith('+') ? value.slice(1) : value;

  // Not the shape P30 leaves behind, so not a cell this rule reads at all.
  if (!/^[0-9]+$/.test(digits)) {
    return false;
  }

  // One key, pressed as many times as it took to fill the cell. Any length.
  if (new Set(digits).size === 1) {
    return true;
  }

  // Seven keys at least, ten at most.
  if (digits.length < 7 || digits.length > 10) {
    return false;
  }

  return PAD_ASCENDING.includes(digits) || PAD_DESCENDING.includes(digits);
}

describe('P35 — a patient phone holding a placeholder', () => {
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
      // The catalogue's own first example, and the same key held down for a
      // different number of presses. One digit repeated is one digit repeated
      // whatever the cell is long.
      { legacyPatientId: 'p-zeroes', phone: '000000000', rawData: '{}' },
      { legacyPatientId: 'p-ones', phone: '1111111111', rawData: '{}' },
      { legacyPatientId: 'p-single', phone: '0', rawData: '{}' },
      { legacyPatientId: 'p-two', phone: '00', rawData: '{}' },
      { legacyPatientId: 'p-long-ones', phone: '1111111111111111', rawData: '{}' },

      // A run of one digit with a `+` written in front of it — the cell P31
      // names when it refuses to read `"+0000000"` as a country code and a
      // number. The `+` is notation, and what follows it is still one key.
      { legacyPatientId: 'p-plus-zeroes', phone: '+0000000', rawData: '{}' },

      // The catalogue's second example, and the same sweep written the other
      // three ways somebody's finger takes it: on past the last key, started at
      // the bottom one, and back up the pad the other way.
      { legacyPatientId: 'p-sweep', phone: '123456789', rawData: '{}' },
      { legacyPatientId: 'p-sweep-full', phone: '1234567890', rawData: '{}' },
      { legacyPatientId: 'p-sweep-from-zero', phone: '0123456789', rawData: '{}' },
      { legacyPatientId: 'p-sweep-down', phone: '987654321', rawData: '{}' },
      { legacyPatientId: 'p-sweep-down-zero', phone: '0987654321', rawData: '{}' },

      // A sweep that starts part way along, at exactly the shortest length a
      // telephone number has anywhere — with and without a leading `+`. These
      // are the cells the floor lets through, and they are the reason the floor
      // is seven rather than something larger.
      { legacyPatientId: 'p-sweep-seven', phone: '3456789', rawData: '{}' },
      { legacyPatientId: 'p-sweep-plus', phone: '+2345678', rawData: '{}' },

      // Left alone: a run too short to have been made to look like a number.
      // What is wrong with three digits, or six, is how many there are, which
      // is P33's question and P33's sentence to a human.
      { legacyPatientId: 'p-three', phone: '123', rawData: '{}' },
      { legacyPatientId: 'p-six', phone: '123456', rawData: '{}' },

      // Left alone: eleven digits, which is a sweep and then something else. A
      // finger passes each of the ten keys once; what an eleventh digit means
      // is not readable from the cell, so this rule does not claim to know.
      { legacyPatientId: 'p-eleven-sweep', phone: '12345678901', rawData: '{}' },

      // Left alone: a near miss. `123456780` skips the 9, so it is not the pad
      // run through — and a rule that called it one would be measuring how
      // sweep-ish a number looks rather than reading the cell.
      { legacyPatientId: 'p-near-sweep', phone: '123456780', rawData: '{}' },

      // Left alone: a number that merely repeats. A repeated pair and a
      // repeated group are neither one digit nor a run, and real numbers hold
      // both.
      { legacyPatientId: 'p-repeated-pair', phone: '1212121212', rawData: '{}' },
      { legacyPatientId: 'p-repeated-group', phone: '0612340612', rawData: '{}' },

      // Left alone: an ordinary Dutch mobile, which happens to hold `12345678`
      // inside it. The sweep has to be the whole cell, or this rule would
      // report real numbers by the hundred. This one is P32's country code.
      { legacyPatientId: 'p-national', phone: '0612345678', rawData: '{}' },

      // Left alone: a placeholder with grouping still on it. P30 takes the
      // spaces and dashes out, and this rule reads what P30 left on the next
      // run — reading through the grouping here would be this rule doing P30's
      // fix silently in order to reach its own test.
      { legacyPatientId: 'p-grouped-zeroes', phone: '000 000 000', rawData: '{}' },
      { legacyPatientId: 'p-dashed-zeroes', phone: '000-000-000', rawData: '{}' },

      // Left alone: a letter in the cell, which is P34's whole finding whatever
      // the digits beside it look like.
      { legacyPatientId: 'p-letters', phone: '000000000 ext', rawData: '{}' },
      { legacyPatientId: 'p-word', phone: 'geen', rawData: '{}' },

      // Left alone: cells somebody typed a real number into, however badly. A
      // `+31` number is done, a `00` exit prefix is P31's, and a count no
      // number has is P33's.
      { legacyPatientId: 'p-plus31', phone: '+31612345678', rawData: '{}' },
      { legacyPatientId: 'p-exit', phone: '0031612345678', rawData: '{}' },
      { legacyPatientId: 'p-long', phone: '1234567890123456', rawData: '{}' },

      // Left alone: nothing in the cell — absent, empty, or whitespace only. A
      // placeholder is the opposite of an empty cell, and an empty phone is
      // P36's finding.
      { legacyPatientId: 'p-null', phone: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', phone: '', rawData: '{}' },
      { legacyPatientId: 'p-blank', phone: '   ', rawData: '{}' },

      // Left alone: a run of zeroes sitting in another column entirely. P35
      // tests one column and reports against that column (1.1.5), and this
      // row's phone is an ordinary number.
      {
        legacyPatientId: 'p-othercolumn',
        phone: '+31612345678',
        bsn: '000000000',
        fullName: 'Jan de Vries',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's — and the
      // phone here is an ordinary number.
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

  it('reports every phone holding a placeholder, and nothing else', async () => {
    const response = await p35.run(context);

    // One call, every row (1.1.14). `prev` is the cell verbatim so the human
    // sees the digits as they were typed, `next` is null throughout (1.1.12),
    // and `column` is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-long-ones',
        column: 'phone',
        prev: '1111111111111111',
        next: null,
      },
      { table: 'patient', legacyId: 'p-ones', column: 'phone', prev: '1111111111', next: null },
      {
        table: 'patient',
        legacyId: 'p-plus-zeroes',
        column: 'phone',
        prev: '+0000000',
        next: null,
      },
      { table: 'patient', legacyId: 'p-single', column: 'phone', prev: '0', next: null },
      { table: 'patient', legacyId: 'p-sweep', column: 'phone', prev: '123456789', next: null },
      {
        table: 'patient',
        legacyId: 'p-sweep-down',
        column: 'phone',
        prev: '987654321',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-sweep-down-zero',
        column: 'phone',
        prev: '0987654321',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-sweep-from-zero',
        column: 'phone',
        prev: '0123456789',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-sweep-full',
        column: 'phone',
        prev: '1234567890',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-sweep-plus',
        column: 'phone',
        prev: '+2345678',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-sweep-seven',
        column: 'phone',
        prev: '3456789',
        next: null,
      },
      { table: 'patient', legacyId: 'p-two', column: 'phone', prev: '00', next: null },
      { table: 'patient', legacyId: 'p-zeroes', column: 'phone', prev: '000000000', next: null },
    ]);
  });

  it('is the catalogue test — one digit repeated, or the keypad run straight through', async () => {
    const response = await p35.run(context);

    // Every reported cell, measured against the test written independently of
    // the rule: one distinct character, or a substring of the pad written out
    // twice.
    for (const update of response.updates) {
      expect(isPlaceholder(update.prev ?? '')).toBe(true);
    }

    // And the other side of it: every fixture the rule walked past is not a
    // placeholder by that same independent test. Nothing was missed.
    const touched = new Set(response.updates.map((update) => update.legacyId));
    const stored = await patients.find();

    for (const patient of stored) {
      if (touched.has(patient.legacyPatientId) || patient.phone === null) {
        continue;
      }

      expect(isPlaceholder(patient.phone)).toBe(false);
    }
  });

  it("catches the catalogue's examples, and the same sweep however the finger took it", async () => {
    const response = await p35.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // The two values the catalogue prints.
    expect(touched).toContain('p-zeroes');
    expect(touched).toContain('p-sweep');

    // "All one digit", which is the same finding at any length and with a `+`
    // in front of it — one key pressed once, twice, ten times or sixteen.
    expect(touched).toContain('p-ones');
    expect(touched).toContain('p-single');
    expect(touched).toContain('p-two');
    expect(touched).toContain('p-long-ones');
    expect(touched).toContain('p-plus-zeroes');

    // The pad run through the other three ways: on past the last key, started
    // at the bottom one, and back the other way. Reading only the nine
    // characters the catalogue happens to print would report one of these and
    // migrate the rest as patients' telephone numbers.
    expect(touched).toContain('p-sweep-full');
    expect(touched).toContain('p-sweep-from-zero');
    expect(touched).toContain('p-sweep-down');
    expect(touched).toContain('p-sweep-down-zero');

    // A sweep starting part way along, at the shortest length a telephone
    // number has anywhere — the floor lets these through on purpose.
    expect(touched).toContain('p-sweep-seven');
    expect(touched).toContain('p-sweep-plus');
  });

  it('holds both bounds on a run: at least seven digits, and at most ten', async () => {
    const response = await p35.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Below seven a cell is too short to be a telephone number anywhere, so it
    // was never made to look like one. What is wrong with it is the count, and
    // the count is P33's question.
    expect(touched).not.toContain('p-three');
    expect(touched).not.toContain('p-six');

    // Above ten a run has passed a key twice, so the cell is a sweep and then
    // something else — and what that something is, this rule cannot read out of
    // the cell.
    expect(touched).not.toContain('p-eleven-sweep');

    // A run of one digit carries no floor at all: three presses of one key and
    // nine presses of it are the same act, and P33 hands every length of it
    // over for exactly that reason.
    expect(touched).toContain('p-two');
    expect(touched).toContain('p-single');
  });

  it('leaves a number that merely repeats, or holds a run inside it, alone', async () => {
    const response = await p35.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A repeated pair and a repeated group are neither one digit nor a run.
    // Calling them placeholders would mean deciding how patterned a number has
    // to be before nobody believes it, which is a judgement rather than a
    // reading of the cell.
    expect(touched).not.toContain('p-repeated-pair');
    expect(touched).not.toContain('p-repeated-group');

    // The sweep has to be the whole cell. An ordinary Dutch mobile holds
    // `12345678` inside it, and a rule matching a run anywhere in the cell
    // would report real numbers by the hundred.
    expect(touched).not.toContain('p-national');

    // A near miss is a miss: `123456780` skips the 9.
    expect(touched).not.toContain('p-near-sweep');
  });

  it('leaves the cells the other phone rules own alone', async () => {
    const response = await p35.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Grouping is P30's fix, and this rule reads what P30 leaves behind rather
    // than doing P30's fix silently in order to reach its own test.
    expect(touched).not.toContain('p-grouped-zeroes');
    expect(touched).not.toContain('p-dashed-zeroes');

    // A letter anywhere in the cell is P34's whole finding, whatever the digits
    // beside it look like.
    expect(touched).not.toContain('p-letters');
    expect(touched).not.toContain('p-word');

    // Cells somebody typed a real number into: a `+31` number, a `00` exit
    // prefix (P31's), and a count no number has (P33's).
    expect(touched).not.toContain('p-plus31');
    expect(touched).not.toContain('p-exit');
    expect(touched).not.toContain('p-long');

    // Nothing in the column at all: absent, empty, whitespace only — P36's.
    expect(touched).not.toContain('p-null');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-blank');
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p35.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `phone`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.phone).toBe(update.prev);
    }
  });

  it('reports against the column it tested and no other', async () => {
    const response = await p35.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A run of zeroes in `bsn` is that column's rules (1.1.5), and this row's
    // phone is an ordinary number — as is the padded id's, which is P01's
    // finding and not this rule's.
    expect(touched).not.toContain('p-othercolumn');
    expect(touched).not.toContain(' p-paddedid ');

    for (const update of response.updates) {
      expect(update.column).toBe('phone');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p35.run(context);

    // The catalogue marks P35 ambiguous: a placeholder encodes that nobody
    // wrote a number down, nothing else in the row spells a telephone number,
    // and an invented one of the right shape rings on a stranger's handset. The
    // flag is rule-wide (1.1.12), stated once beside the updates, and the `rule`
    // row says the same thing the response does, which is what makes the
    // description the human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p35.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p35]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P35', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once the number is in the cell, or the cell is cleared', async () => {
    const before = await p35.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-zeroes');
    expect(before.updates.map((update) => update.legacyId)).toContain('p-sweep');

    // What resolving an ambiguous finding does: a human writes the patient's
    // own number into the column the rule tested (1.1.5), or — where there
    // never was one — empties the cell, which is then P36's ordinary empty
    // finding rather than this one. The rule is self-terminating either way,
    // because it tests what it reports on.
    await patients.update({ legacyPatientId: 'p-zeroes' }, { phone: '+31612345678' });
    await patients.update({ legacyPatientId: 'p-sweep' }, { phone: null });

    const after = await p35.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-zeroes');
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-sweep');

    await patients.update({ legacyPatientId: 'p-zeroes' }, { phone: '000000000' });
    await patients.update({ legacyPatientId: 'p-sweep' }, { phone: '123456789' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p35.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — a placeholder quietly cleared most of all.
    expect(before).toHaveLength(FIXTURE_ROWS);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P35 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p35);
    expect(p35.ruleId).toBe('P35');
    expect(p35.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), and
    // for an ambiguous rule it is the whole explanation, since there is no
    // proposed value to show.
    expect(p35.ruleName.length).toBeGreaterThan(0);
    expect(p35.description.length).toBeGreaterThan(0);
  });
});
