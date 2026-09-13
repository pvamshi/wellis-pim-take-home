import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p02 } from '../src/rules/catalogue/p02';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P02 — a patient row whose `legacy_id` is empty, against a real database with
 * real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/**
 * Sorted, so no assertion depends on the order rows come back in. Every value
 * this rule reports is blank, so they are compared as their JSON escapes and by
 * code unit rather than by locale — a collation that treats a tab, a space and
 * nothing at all as equivalent would not order them at all.
 */
function byPrev(updates: RuleUpdate[]): RuleUpdate[] {
  const key = (update: RuleUpdate): string => JSON.stringify(update.prev);

  return [...updates].sort((left, right) => {
    if (key(left) === key(right)) {
      return 0;
    }

    return key(left) < key(right) ? -1 : 1;
  });
}

describe('P02 — a patient row with no legacy id', () => {
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
      // What the rule is for: an id that is not there. An empty cell, one that
      // holds only spaces, and one that holds only a tab and a newline —
      // whitespace is not content, and none of the three addresses anything.
      { legacyPatientId: '', fullName: 'Nina Bakker', rawData: '{"id":""}' },
      { legacyPatientId: '   ', fullName: 'Joris Smit', rawData: '{"id":"   "}' },
      { legacyPatientId: '\t\n', fullName: 'Eva de Wit', rawData: '{"id":"\\t\\n"}' },

      // Left alone: an ordinary id.
      { legacyPatientId: 'rec-clean', rawData: '{"id":"rec-clean"}' },

      // Left alone: padding around a real id is P01's fix, and the row is still
      // addressable. P02 catches the id that is only padding, never the one
      // that merely has some.
      { legacyPatientId: ' rec-lead ', rawData: '{"id":" rec-lead "}' },

      // Left alone: a space in the middle of an id is not an absent id.
      { legacyPatientId: 'rec inner', rawData: '{"id":"rec inner"}' },

      // Left alone: emptiness in another column entirely. P02 tests one column
      // (1.1.5) and this row's id is there.
      {
        legacyPatientId: 'rec-other-column',
        fullName: '',
        email: '   ',
        city: null,
        rawData: '{"id":"rec-other-column"}',
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

  it('reports every row whose legacy id is empty or only whitespace', async () => {
    const response = await p02.run(context);

    // One call, every row (1.1.14). `column` is the column that was tested
    // (1.1.5), `prev` is what it held verbatim — an empty string and three
    // spaces are different things to whoever reads the row — and `next` is null
    // on all of them because there is nothing to propose.
    expect(byPrev(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: '   ',
        column: 'legacy_id',
        prev: '   ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: '',
        column: 'legacy_id',
        prev: '',
        next: null,
      },
      {
        table: 'patient',
        legacyId: '\t\n',
        column: 'legacy_id',
        prev: '\t\n',
        next: null,
      },
    ]);
  });

  it('addresses each finding by the empty id, which is all the row has', async () => {
    const response = await p02.run(context);

    // `legacyId` is how the persistence layer addresses the finding (1.1.3).
    // For this rule that address is itself empty, which is the point the
    // catalogue makes: the row cannot be addressed at all. Every finding still
    // names the value it reports as `prev`, and that value is really in the
    // table.
    for (const update of response.updates) {
      expect(update.legacyId).toBe(update.prev);

      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
    }
  });

  it('leaves any id with content in it alone, however untidy', async () => {
    const response = await p02.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // A clean id has nothing wrong with it. A padded id is addressable once
    // trimmed, which is P01's fix and not a finding here (1.1.4). An inner
    // space is neither rule's.
    expect(touched).not.toContain('rec-clean');
    expect(touched).not.toContain(' rec-lead ');
    expect(touched).not.toContain('rec inner');

    // And no other column is reported against, however empty it is (1.1.5).
    expect(touched).not.toContain('rec-other-column');
    for (const update of response.updates) {
      expect(update.column).toBe('legacy_id');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p02.run(context);

    // The catalogue marks P02 ambiguous: an id is issued, not derived, so there
    // is nothing to propose. The flag is rule-wide (1.1.12) — stated once
    // beside the updates — and the `rule` row says the same thing the response
    // does, which is what makes the description the human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p02.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p02]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P02', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p02.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(7);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P02 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p02);
    expect(p02.ruleId).toBe('P02');
    expect(p02.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p02.ruleName.length).toBeGreaterThan(0);
    expect(p02.description.length).toBeGreaterThan(0);
  });
});
