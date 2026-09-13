import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p30 } from '../src/rules/catalogue/p30';
import { p36 } from '../src/rules/catalogue/p36';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P36 — a patient row with no `phone` in it at all, against a real database
 * with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 25;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P36 — a patient phone that is empty', () => {
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
      // What the rule is for. Three ways a cell arrives with nothing in it: an
      // empty cell, an absent column, and whitespace somebody typed.
      { legacyPatientId: 'p-empty', phone: '', rawData: '{}' },
      { legacyPatientId: 'p-null', phone: null, rawData: '{}' },
      { legacyPatientId: 'p-space', phone: ' ', rawData: '{}' },
      { legacyPatientId: 'p-spaces', phone: '   ', rawData: '{}' },
      { legacyPatientId: 'p-tab', phone: '\t', rawData: '{}' },
      { legacyPatientId: 'p-newline', phone: '\n', rawData: '{}' },
      { legacyPatientId: 'p-mixedblank', phone: ' \t \n ', rawData: '{}' },

      // Left alone: a number somebody can be reached on, however it is written.
      // Nothing here is absent, so nothing here is this rule's.
      { legacyPatientId: 'p-national', phone: '0612345678', rawData: '{}' },
      { legacyPatientId: 'p-international', phone: '+31612345678', rawData: '{}' },

      // Left alone: grouping and padding, which are P30's fix. A padded number
      // is untidy, not missing — the whitespace is around a value.
      { legacyPatientId: 'p-grouped', phone: '06 12 34 56 78', rawData: '{}' },
      { legacyPatientId: 'p-dashed', phone: '06-12345678', rawData: '{}' },
      { legacyPatientId: 'p-padded', phone: '  0612345678  ', rawData: '{}' },

      // Left alone: the prefix rules. `00` in front of a country code is P31's
      // fix, and this column's other rules each read a cell with digits in it.
      { legacyPatientId: 'p-exitprefix', phone: '0031612345678', rawData: '{}' },

      // Left alone: a count no telephone number has, which is P33's finding. A
      // number not finished is not the same as a number not given.
      { legacyPatientId: 'p-tooshort', phone: '06123', rawData: '{}' },
      { legacyPatientId: 'p-toolong', phone: '1234567890123456', rawData: '{}' },

      // Left alone: letters, a word and an extension, which are P34's finding.
      // `geen` is somebody writing "there isn't one" into the box — there is
      // text in the cell to take out, so P34's sentence is the true one.
      { legacyPatientId: 'p-word', phone: 'geen', rawData: '{}' },
      { legacyPatientId: 'p-unknown', phone: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-extension', phone: '0201234567 ext 12', rawData: '{}' },

      // Left alone: a placeholder, which is P35's finding — the cell
      // pretending not to be empty rather than the cell that is.
      { legacyPatientId: 'p-placeholder', phone: '000000000', rawData: '{}' },
      { legacyPatientId: 'p-sweep', phone: '123456789', rawData: '{}' },

      // Left alone: a mark somebody typed instead of a number. These look like
      // nothing to a reader, but they are characters in the cell, and deciding
      // on our own which marks count as empty would be a guess.
      { legacyPatientId: 'p-dash', phone: '-', rawData: '{}' },
      { legacyPatientId: 'p-brackets', phone: '()', rawData: '{}' },
      { legacyPatientId: 'p-plus', phone: '+', rawData: '{}' },
      { legacyPatientId: 'p-question', phone: '?', rawData: '{}' },

      // Left alone: empty columns that are not this one. This rule tests one
      // column (1.1.5), and this row has a phone number — the empty name is
      // P08's, the empty email P15's, the blank dob P22's, the empty sex P25's
      // and the padded legacy id P01's.
      {
        legacyPatientId: ' p-othercolumn ',
        phone: '+31612345678',
        fullName: '',
        email: '   ',
        dob: '',
        sex: '',
        bsn: '',
        city: '',
        weight: '',
        weightUnit: '',
        status: '',
        rawData: '{}',
      },
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

  it('reports every row with no phone in it, and nothing else', async () => {
    const response = await p36.run(context);

    // One call, every row (1.1.14). `prev` is the cell verbatim, so an absent
    // number, an empty cell and a cell of whitespace stay distinguishable to
    // the human reading the row, and `column` is the column that was tested
    // (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      { table: 'patient', legacyId: 'p-empty', column: 'phone', prev: '', next: null },
      { table: 'patient', legacyId: 'p-mixedblank', column: 'phone', prev: ' \t \n ', next: null },
      { table: 'patient', legacyId: 'p-newline', column: 'phone', prev: '\n', next: null },
      // The column is nullable, and a source row that never had it lands here.
      { table: 'patient', legacyId: 'p-null', column: 'phone', prev: null, next: null },
      { table: 'patient', legacyId: 'p-space', column: 'phone', prev: ' ', next: null },
      { table: 'patient', legacyId: 'p-spaces', column: 'phone', prev: '   ', next: null },
      { table: 'patient', legacyId: 'p-tab', column: 'phone', prev: '\t', next: null },
    ]);
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p36.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `phone`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the nothing it reports as
    // `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.phone).toBe(update.prev);
    }
  });

  it('leaves every cell with something in it alone, and every other column', async () => {
    const response = await p36.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A number, however it is written. Padding around one is P30's fix —
    // `"  0612345678  "` is untidy, not absent.
    expect(touched).not.toContain('p-national');
    expect(touched).not.toContain('p-international');
    expect(touched).not.toContain('p-grouped');
    expect(touched).not.toContain('p-dashed');
    expect(touched).not.toContain('p-padded');
    expect(touched).not.toContain('p-exitprefix');

    // A cell that claims to hold a number and does not: too few or too many
    // digits is P33's finding, letters and an extension are P34's, a
    // placeholder is P35's. A row two rules matched would put two findings in
    // front of a human for one problem (1.1.4).
    expect(touched).not.toContain('p-tooshort');
    expect(touched).not.toContain('p-toolong');
    expect(touched).not.toContain('p-word');
    expect(touched).not.toContain('p-unknown');
    expect(touched).not.toContain('p-extension');
    expect(touched).not.toContain('p-placeholder');
    expect(touched).not.toContain('p-sweep');

    // A mark typed instead of a number is a character in the cell, not an
    // absence. Sweeping these in would be this rule deciding which marks count
    // as empty.
    expect(touched).not.toContain('p-dash');
    expect(touched).not.toContain('p-brackets');
    expect(touched).not.toContain('p-plus');
    expect(touched).not.toContain('p-question');

    // And no other column is reported against, however empty it is (1.1.5) —
    // including the padded legacy id, which is P01's.
    expect(touched).not.toContain(' p-othercolumn ');
    for (const update of response.updates) {
      expect(update.column).toBe('phone');
      expect(update.table).toBe('patient');
    }
  });

  it('owns the cell that holds nothing but whitespace, which P30 hands over', async () => {
    const cleaned = await p30.run(context);
    const reported = await p36.run(context);

    // P30 removes the grouping it names and stops short of the cell that was
    // only grouping: `"   "` cleans away to nothing, and a rule whose fix is
    // "the digits" cannot propose a number with none in it. So a cell of
    // whitespace is this rule's, and it is reported by exactly one of the two.
    expect(cleaned.updates.map((update) => update.legacyId)).not.toContain('p-spaces');
    expect(reported.updates.map((update) => update.legacyId)).toContain('p-spaces');

    // The padded number is the other side of the same handoff: P30 cleans it,
    // and this rule walks past it, because there is a number in that cell.
    expect(cleaned.updates.map((update) => update.legacyId)).toContain('p-padded');
    expect(reported.updates.map((update) => update.legacyId)).not.toContain('p-padded');
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p36.run(context);

    // The catalogue marks P36 ambiguous: a telephone number is not derivable
    // from anything else in the row, an invented one would ring on a
    // stranger's handset, and the blank may itself be the truthful answer. The
    // flag is rule-wide (1.1.12) — stated once beside the updates — and the
    // `rule` row says the same thing the response does, which is what makes the
    // description the human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p36.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p36]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P36', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once a number is in the cell', async () => {
    const before = await p36.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-empty');

    // What resolving an ambiguous finding does: a human finds the number and
    // writes it into the column the rule tested (1.1.5). The rule is
    // self-terminating — it tests what it reports on, so the row does not come
    // back.
    await patients.update({ legacyPatientId: 'p-empty' }, { phone: '+31612345678' });

    const after = await p36.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-empty');

    await patients.update({ legacyPatientId: 'p-empty' }, { phone: '' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p36.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — an empty phone quietly filled in most of all.
    expect(before).toHaveLength(FIXTURE_ROWS);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P36 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p36);
    expect(p36.ruleId).toBe('P36');
    expect(p36.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p36.ruleName.length).toBeGreaterThan(0);
    expect(p36.description.length).toBeGreaterThan(0);
  });
});
