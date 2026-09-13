import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p37 } from '../src/rules/catalogue/p37';
import { p38 } from '../src/rules/catalogue/p38';
import { p39 } from '../src/rules/catalogue/p39';
import { p40 } from '../src/rules/catalogue/p40';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P40 — a patient row with no `city` in it at all, against a real database with
 * real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Every fixture row below, so `writes nothing` counts what it compares. */
const FIXTURE_ROWS = 21;

/**
 * A non-breaking space, U+00A0, built from its code point rather than typed
 * into the source, where it would be indistinguishable from an ordinary space
 * to anybody reading this file. It reads as blank in every screen that shows
 * the row, and `trim` treats it as the whitespace it is.
 */
const NBSP = String.fromCharCode(0xa0);

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P40 — a patient city that is empty', () => {
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
      // empty cell, an absent column, and whitespace somebody typed — including
      // a non-breaking space, which reads as blank and is blank.
      { legacyPatientId: 'p-empty', city: '', rawData: '{}' },
      { legacyPatientId: 'p-null', city: null, rawData: '{}' },
      { legacyPatientId: 'p-space', city: ' ', rawData: '{}' },
      { legacyPatientId: 'p-spaces', city: '   ', rawData: '{}' },
      { legacyPatientId: 'p-tab', city: '\t', rawData: '{}' },
      { legacyPatientId: 'p-newline', city: '\n', rawData: '{}' },
      { legacyPatientId: 'p-mixedblank', city: ' \t \n ', rawData: '{}' },
      { legacyPatientId: 'p-nbsp', city: NBSP, rawData: '{}' },

      // Left alone: a town, written as itself. Nothing is missing here, which is
      // what the column is for.
      { legacyPatientId: 'p-town', city: 'Amsterdam', rawData: '{}' },
      { legacyPatientId: 'p-compound', city: 'Bergen op Zoom', rawData: '{}' },

      // Left alone: spacing and casing, which are P37's fix. A padded town name
      // is untidy, not absent — the whitespace is around a value.
      { legacyPatientId: 'p-padded', city: '  Amsterdam  ', rawData: '{}' },
      { legacyPatientId: 'p-lower', city: 'amsterdam', rawData: '{}' },
      { legacyPatientId: 'p-caps', city: 'ROTTERDAM', rawData: '{}' },

      // Left alone: an alias, which is P38's fix. It names a place, in fewer
      // letters than the place uses itself.
      { legacyPatientId: 'p-alias', city: "A'dam", rawData: '{}' },
      { legacyPatientId: 'p-denbosch', city: 'Den Bosch', rawData: '{}' },

      // Left alone: a postcode and a whole address, which are P39's finding —
      // the wrong thing in the column rather than nothing in it.
      { legacyPatientId: 'p-postcode', city: '1012 AB', rawData: '{}' },
      { legacyPatientId: 'p-address', city: 'Kerkstraat 12, Amsterdam', rawData: '{}' },

      // Left alone: a word that says in letters what a blank says by being
      // blank. It is still text in the cell, and deciding which words mean
      // nothing would be this rule guessing.
      { legacyPatientId: 'p-word', city: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-na', city: 'n.v.t.', rawData: '{}' },

      // Left alone: a mark somebody typed instead of a town. These look like
      // nothing to a reader, but they are characters in the cell.
      { legacyPatientId: 'p-dash', city: '-', rawData: '{}' },

      // Left alone: empty columns that are not this one. This rule tests one
      // column (1.1.5), and this row has a city — the empty name is P08's, the
      // empty email P15's, the blank dob P22's, the empty sex P25's, the empty
      // phone P36's and the padded legacy id P01's.
      {
        legacyPatientId: ' p-othercolumn ',
        city: 'Amsterdam',
        fullName: '',
        email: '   ',
        dob: '',
        sex: '',
        bsn: '',
        phone: '',
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

  it('reports every row with no city in it, and nothing else', async () => {
    const response = await p40.run(context);

    // One call, every row (1.1.14). `prev` is the cell verbatim, so an absent
    // town, an empty cell and a cell of whitespace stay distinguishable to the
    // human reading the row, and `column` is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      { table: 'patient', legacyId: 'p-empty', column: 'city', prev: '', next: null },
      { table: 'patient', legacyId: 'p-mixedblank', column: 'city', prev: ' \t \n ', next: null },
      { table: 'patient', legacyId: 'p-nbsp', column: 'city', prev: NBSP, next: null },
      { table: 'patient', legacyId: 'p-newline', column: 'city', prev: '\n', next: null },
      // The column is nullable, and a source row that never had it lands here.
      { table: 'patient', legacyId: 'p-null', column: 'city', prev: null, next: null },
      { table: 'patient', legacyId: 'p-space', column: 'city', prev: ' ', next: null },
      { table: 'patient', legacyId: 'p-spaces', column: 'city', prev: '   ', next: null },
      { table: 'patient', legacyId: 'p-tab', column: 'city', prev: '\t', next: null },
    ]);
  });

  it('addresses each finding by the row it read the value from', async () => {
    const response = await p40.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `city`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the nothing it reports as
    // `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.city).toBe(update.prev);
    }
  });

  it('leaves every cell with something in it alone, and every other column', async () => {
    const response = await p40.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A town, however it is written. Spacing and casing are P37's fix and an
    // alias is P38's — all of them name a place.
    expect(touched).not.toContain('p-town');
    expect(touched).not.toContain('p-compound');
    expect(touched).not.toContain('p-padded');
    expect(touched).not.toContain('p-lower');
    expect(touched).not.toContain('p-caps');
    expect(touched).not.toContain('p-alias');
    expect(touched).not.toContain('p-denbosch');

    // A cell holding the wrong thing rather than nothing: a postcode or a whole
    // address is P39's finding. A row two rules matched would put two findings
    // in front of a human for one problem (1.1.4).
    expect(touched).not.toContain('p-postcode');
    expect(touched).not.toContain('p-address');

    // A word meaning "there is none", and a mark typed instead of a town. Both
    // are characters in the cell, not an absence — sweeping them in would be
    // this rule deciding which words and marks count as empty.
    expect(touched).not.toContain('p-word');
    expect(touched).not.toContain('p-na');
    expect(touched).not.toContain('p-dash');

    // And no other column is reported against, however empty it is (1.1.5) —
    // including the padded legacy id, which is P01's.
    expect(touched).not.toContain(' p-othercolumn ');
    for (const update of response.updates) {
      expect(update.column).toBe('city');
      expect(update.table).toBe('patient');
    }
  });

  it('owns the cell that holds nothing but whitespace, which P37 hands over', async () => {
    const cleaned = await p37.run(context);
    const reported = await p40.run(context);

    // P37 cleans the spacing it names and stops short of the cell that was only
    // spacing: `"   "` cleans away to nothing, and proposing an empty city would
    // be proposing the very state this rule asks a human about. So a cell of
    // whitespace is this rule's, and it is reported by exactly one of the two.
    expect(cleaned.updates.map((update) => update.legacyId)).not.toContain('p-spaces');
    expect(reported.updates.map((update) => update.legacyId)).toContain('p-spaces');

    // The padded town is the other side of the same handoff: P37 cleans it, and
    // this rule walks past it, because there is a town in that cell.
    expect(cleaned.updates.map((update) => update.legacyId)).toContain('p-padded');
    expect(reported.updates.map((update) => update.legacyId)).not.toContain('p-padded');
  });

  it('is the only rule on this column that claims an empty cell', async () => {
    const blanks = ['p-empty', 'p-null', 'p-spaces', 'p-nbsp'];
    const others = [await p37.run(context), await p38.run(context), await p39.run(context)];

    // One rule, one fix (1.1.4). P37 has nothing to clean, P38 finds no alias
    // and P39 finds no digit, so an empty city reaches a human once, under this
    // rule's sentence and no other.
    for (const response of others) {
      for (const blank of blanks) {
        expect(response.updates.map((update) => update.legacyId)).not.toContain(blank);
      }
    }

    const reported = (await p40.run(context)).updates.map((update) => update.legacyId);
    for (const blank of blanks) {
      expect(reported).toContain(blank);
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p40.run(context);

    // The catalogue marks P40 ambiguous: the town is nowhere else in the row,
    // an invented one files the patient in a place they do not live, and the
    // blank may itself be the truthful answer. The flag is rule-wide (1.1.12) —
    // stated once beside the updates — and the `rule` row says the same thing
    // the response does, which is what makes the description the human's only
    // explanation.
    expect(response.ambiguity).toBe(true);
    expect(p40.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p40]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P40', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('stops matching once a town is in the cell', async () => {
    const before = await p40.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-empty');

    // What resolving an ambiguous finding does: a human finds the town and
    // writes it into the column the rule tested (1.1.5). The rule is
    // self-terminating — it tests what it reports on, so the row does not come
    // back.
    await patients.update({ legacyPatientId: 'p-empty' }, { city: 'Zwolle' });

    const after = await p40.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-empty');

    await patients.update({ legacyPatientId: 'p-empty' }, { city: '' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p40.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — an empty city quietly filled in most of all.
    expect(before).toHaveLength(FIXTURE_ROWS);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P40 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p40);
    expect(p40.ruleId).toBe('P40');
    expect(p40.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p40.ruleName.length).toBeGreaterThan(0);
    expect(p40.description.length).toBeGreaterThan(0);
  });
});
