import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p08 } from '../src/rules/catalogue/p08';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P08 — a patient row with no `full_name` at all, against a real database with
 * real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P08 — a patient name that is empty', () => {
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
      // What the rule is for, in all three ways a cell arrives with no name in
      // it: the column absent, the cell empty, and the cell typed into with
      // nothing but spacing.
      { legacyPatientId: 'p-null', fullName: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', fullName: '', rawData: '{}' },
      { legacyPatientId: 'p-spaces', fullName: '   ', rawData: '{}' },
      { legacyPatientId: 'p-tab', fullName: '\t', rawData: '{}' },
      { legacyPatientId: 'p-newline', fullName: '\n ', rawData: '{}' },

      // Reported too, and reported anyway: the rest of the row carries plenty
      // to identify this person by and none of it is a name. This is the row
      // that proves the rule does not fill the column from a hint.
      {
        legacyPatientId: 'p-empty-with-contact',
        fullName: '',
        email: 'j.smit@gmail.com',
        phone: '06-53549409',
        dob: '1978-04-02',
        city: 'Utrecht',
        rawData: '{}',
      },

      // Left alone: an ordinary name, and the names the other `full_name` rules
      // own. Each is wrong in its own way and every one of them is a name.
      { legacyPatientId: 'p-plain', fullName: 'Jan de Vries', rawData: '{}' },
      { legacyPatientId: 'p-padded', fullName: '  Jan  de Vries ', rawData: '{}' },
      { legacyPatientId: 'p-shouted', fullName: 'JAN DE VRIES', rawData: '{}' },
      { legacyPatientId: 'p-inverted', fullName: 'Berg, Jan van der', rawData: '{}' },
      { legacyPatientId: 'p-title', fullName: 'Dhr. Jan de Vries', rawData: '{}' },

      // Left alone: contact detail written into the name box is P07's finding.
      // The cell is not empty — it holds the wrong thing, which is a different
      // question from holding nothing.
      { legacyPatientId: 'p-email', fullName: 'jan.devries@gmail.com', rawData: '{}' },
      { legacyPatientId: 'p-phone', fullName: '06-53549409', rawData: '{}' },

      // Left alone: one token and no surname is P09's finding. A name that is
      // half a name is still a name.
      { legacyPatientId: 'p-single', fullName: 'Jan', rawData: '{}' },

      // Left alone: a single character is content. Nothing here says it is not
      // what somebody is called, and a rule reporting an empty cell must not
      // report a cell with something in it.
      { legacyPatientId: 'p-one-letter', fullName: 'X', rawData: '{}' },

      // Left alone: a placeholder is a value somebody chose, not an empty cell.
      // Whatever should happen to it, it is not this rule's finding (1.1.4).
      { legacyPatientId: 'p-dash', fullName: '-', rawData: '{}' },
      { legacyPatientId: 'p-unknown', fullName: 'onbekend', rawData: '{}' },

      // Left alone: emptiness in another column. P22 owns an empty `dob`, P36
      // an empty `phone`, P40 an empty `city` — this rule tests one column
      // (1.1.5) and this row's name is a name.
      {
        legacyPatientId: 'p-other-column-empty',
        fullName: 'Piet Jansen',
        email: '',
        dob: '',
        phone: '   ',
        city: null,
        rawData: '{}',
      },

      // Reported, and the id is reported exactly as the row holds it: padding
      // on the id is P01's fix and an empty id is P02's finding, and neither
      // stops this rule from saying that this row has no name.
      { legacyPatientId: ' p-padded-id ', fullName: '', rawData: '{}' },
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

  it('reports every row whose name is absent, empty or nothing but whitespace', async () => {
    const response = await p08.run(context);

    // One call, every row (1.1.14). `column` is the column that was tested
    // (1.1.5), `prev` is what it held verbatim — so `null`, `''` and `'   '`
    // stay three distinguishable things to the human reading the row — and
    // `next` is null on all of them because there is nothing to propose.
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: ' p-padded-id ',
        column: 'full_name',
        prev: '',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-empty',
        column: 'full_name',
        prev: '',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-empty-with-contact',
        column: 'full_name',
        prev: '',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-newline',
        column: 'full_name',
        prev: '\n ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-null',
        column: 'full_name',
        prev: null,
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-spaces',
        column: 'full_name',
        prev: '   ',
        next: null,
      },
      {
        table: 'patient',
        legacyId: 'p-tab',
        column: 'full_name',
        prev: '\t',
        next: null,
      },
    ]);
  });

  it('addresses each finding by the row it read the name from', async () => {
    const response = await p08.run(context);

    // `legacyId` is how the persistence layer addresses the finding (1.1.3).
    // This rule tests `full_name`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.fullName).toBe(update.prev);
    }
  });

  it('leaves a name alone, however else it is wrong', async () => {
    const response = await p08.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // An ordinary name, and the names that belong to P03, P04, P05, P06, P07
    // and P09, all have something in them. A cell holding the wrong thing is a
    // different finding from a cell holding nothing (1.1.4).
    expect(touched).not.toContain('p-plain');
    expect(touched).not.toContain('p-padded');
    expect(touched).not.toContain('p-shouted');
    expect(touched).not.toContain('p-inverted');
    expect(touched).not.toContain('p-title');
    expect(touched).not.toContain('p-email');
    expect(touched).not.toContain('p-phone');
    expect(touched).not.toContain('p-single');

    // One character is content, and so is a placeholder somebody typed on
    // purpose. Neither cell is empty.
    expect(touched).not.toContain('p-one-letter');
    expect(touched).not.toContain('p-dash');
    expect(touched).not.toContain('p-unknown');

    // And no other column is reported against, however empty it is (1.1.5).
    expect(touched).not.toContain('p-other-column-empty');
    for (const update of response.updates) {
      expect(update.column).toBe('full_name');
      expect(update.table).toBe('patient');
    }
  });

  it('is ambiguous, and proposes no value anywhere', async () => {
    const response = await p08.run(context);

    // The catalogue marks P08 ambiguous: a name is not derivable from an email
    // address, a date of birth or anything else the export holds, so there is
    // nothing to propose. The flag is rule-wide (1.1.12) — stated once beside
    // the updates — and the `rule` row says the same thing the response does,
    // which is what makes the description the human's only explanation.
    expect(response.ambiguity).toBe(true);
    expect(p08.ambiguous).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).toBeNull();
    }
  });

  it('satisfies the invariant the runner checks for an ambiguous response', async () => {
    const registry = new RuleRegistry([p08]);

    // The registry rejects a response whose `ambiguity` is true while an update
    // still carries a `next` (1.1.14). Running through it proves this rule's
    // response is one the runner will accept, not only one that looks right.
    const response = await registry.run('P08', 1, context);

    expect(response.ambiguity).toBe(true);
    expect(response.updates.length).toBeGreaterThan(0);
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p08.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up
    // — an empty name quietly filled in most of all.
    expect(before).toHaveLength(19);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P08 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p08);
    expect(p08.ruleId).toBe('P08');
    expect(p08.version).toBe(1);

    // For an ambiguous rule the description is the whole explanation the human
    // reads in place of a proposed value (1.1.12), so it has to be a sentence
    // about this row's problem.
    expect(p08.ruleName.length).toBeGreaterThan(0);
    expect(p08.description.length).toBeGreaterThan(0);
  });
});
