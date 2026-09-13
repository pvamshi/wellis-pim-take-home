import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p01 } from '../src/rules/catalogue/p01';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P01 — a patient `legacy_id` with whitespace around it, against a real
 * database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/**
 * Sorted, so no assertion depends on the order rows come back in. By the
 * proposed id rather than the stored one: the stored ids differ only in their
 * padding, and a locale comparison does not order padding predictably.
 */
function byProposedId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => (left.next ?? '').localeCompare(right.next ?? ''));
}

describe('P01 — a patient legacy id with whitespace around it', () => {
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
      // What the rule is for: a space on one end, the other, or both, and a tab
      // and a newline, which are whitespace too.
      { legacyPatientId: ' rec-lead', rawData: '{"id":" rec-lead"}' },
      { legacyPatientId: 'rec-trail ', rawData: '{"id":"rec-trail "}' },
      { legacyPatientId: '  rec-both  ', rawData: '{"id":"  rec-both  "}' },
      { legacyPatientId: '\trec-tab\n', rawData: '{"id":"\\trec-tab\\n"}' },

      // Left alone: already clean.
      { legacyPatientId: 'rec-clean', rawData: '{"id":"rec-clean"}' },

      // Left alone: the space is in the middle, which is not what P01 catches.
      { legacyPatientId: 'rec inner', rawData: '{"id":"rec inner"}' },

      // Left alone: trimming leaves nothing to address the row by, which is
      // P02's finding and not this rule's fix.
      { legacyPatientId: '   ', rawData: '{"id":"   "}' },
      { legacyPatientId: '', rawData: '{"id":""}' },

      // Left alone: whitespace on another column entirely. P01 tests one column
      // (1.1.5) and this row's id is clean.
      { legacyPatientId: 'rec-other-column', city: '  Utrecht  ', rawData: '{"id":"rec-x"}' },
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

  it('proposes the trimmed id for every id with whitespace around it', async () => {
    const response = await p01.run(context);

    // The value matters, not just that the rule fired: each `next` is the id
    // with its ends removed and nothing else done to it. One call, every row
    // (1.1.14), and `column` is the column that was tested (1.1.5).
    expect(byProposedId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: '  rec-both  ',
        column: 'legacy_id',
        prev: '  rec-both  ',
        next: 'rec-both',
      },
      {
        table: 'patient',
        legacyId: ' rec-lead',
        column: 'legacy_id',
        prev: ' rec-lead',
        next: 'rec-lead',
      },
      {
        table: 'patient',
        legacyId: '\trec-tab\n',
        column: 'legacy_id',
        prev: '\trec-tab\n',
        next: 'rec-tab',
      },
      {
        table: 'patient',
        legacyId: 'rec-trail ',
        column: 'legacy_id',
        prev: 'rec-trail ',
        next: 'rec-trail',
      },
    ]);
  });

  it('addresses each finding by the untrimmed id, which is what the row still holds', async () => {
    const response = await p01.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3), and until the change is approved the row is still stored under
    // the untrimmed id. Every finding addresses the value it also reports as
    // `prev`.
    for (const update of response.updates) {
      expect(update.legacyId).toBe(update.prev);

      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
    }
  });

  it('leaves a clean id, an inner space, and a blank id alone', async () => {
    const response = await p01.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A clean id has nothing to fix. An inner space is not what the catalogue
    // says P01 catches — the entry that names internal whitespace is P03, on
    // another column. And an id that is only whitespace trims to nothing, which
    // is the row P02 reports as unaddressable; proposing an empty id here would
    // be a second fix in one rule (1.1.4).
    expect(touched).not.toContain('rec-clean');
    expect(touched).not.toContain('rec inner');
    expect(touched).not.toContain('   ');
    expect(touched).not.toContain('');

    // And no other column is proposed against, however dirty it is (1.1.5).
    expect(touched).not.toContain('rec-other-column');
    for (const update of response.updates) {
      expect(update.column).toBe('legacy_id');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries a proposed value', async () => {
    const response = await p01.run(context);

    // The catalogue does not mark P01 ambiguous: there is one reading of a
    // padded id. The flag is rule-wide (1.1.12), stated once beside the
    // updates, and the `rule` row says the same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p01.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p01.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('rec-trail ');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). The rule is self-terminating, so the applied row needs no
    // guard to keep it from being re-proposed.
    await patients.update({ legacyPatientId: 'rec-trail ' }, { legacyPatientId: 'rec-trail' });

    const after = await p01.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('rec-trail ');
    expect(after.updates.map((update) => update.legacyId)).not.toContain('rec-trail');

    await patients.update({ legacyPatientId: 'rec-trail' }, { legacyPatientId: 'rec-trail ' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p01.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(9);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P01 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p01);
    expect(p01.ruleId).toBe('P01');
    expect(p01.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p01.ruleName.length).toBeGreaterThan(0);
    expect(p01.description.length).toBeGreaterThan(0);
  });
});
