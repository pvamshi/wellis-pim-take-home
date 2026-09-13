import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p06 } from '../src/rules/catalogue/p06';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P06 — a patient `full_name` carrying a title or salutation, against a real
 * database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P06 — a patient name carrying a title or salutation', () => {
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
      // The catalogue's own four, each in front of an ordinary name.
      { legacyPatientId: 'p-dhr', fullName: 'Dhr. Jan van der Berg', rawData: '{}' },
      { legacyPatientId: 'p-mevr', fullName: 'Mevr. Sanne Bakker', rawData: '{}' },
      { legacyPatientId: 'p-mr', fullName: 'Mr Piet Jansen', rawData: '{}' },
      { legacyPatientId: 'p-drs', fullName: 'Drs. Lotte Smit', rawData: '{}' },

      // The dot is optional in both directions: the catalogue writes `Mr`
      // without one and `Dhr.` with one.
      { legacyPatientId: 'p-dhr-no-dot', fullName: 'Dhr Anne de Wit', rawData: '{}' },
      { legacyPatientId: 'p-mr-dot', fullName: 'Mr. Tom Visser', rawData: '{}' },

      // The rest of the two closed families the catalogue names two of.
      { legacyPatientId: 'p-english-mrs', fullName: 'Mrs Eva Mulder', rawData: '{}' },
      { legacyPatientId: 'p-prof', fullName: 'Prof. Karel Vos', rawData: '{}' },

      // Case is P04's. A shouted salutation is still a salutation.
      { legacyPatientId: 'p-shouted', fullName: 'DHR. JAN DE VRIES', rawData: '{}' },

      // Two forms of address stacked in front of one name; both go.
      { legacyPatientId: 'p-stacked', fullName: 'Dhr. Drs. Koen Bos', rawData: '{}' },

      // A title that is not in front. P06 and P05 answer for themselves (D3),
      // so the salutation goes whether or not the name has been un-inverted.
      { legacyPatientId: 'p-inverted', fullName: 'Berg, Dhr. Jan van der', rawData: '{}' },
      { legacyPatientId: 'p-trailing', fullName: 'Marieke Peters Drs.', rawData: '{}' },
      { legacyPatientId: 'p-middle', fullName: 'Jan Drs.  de Vries', rawData: '{}' },

      // The title only. The padding and the doubled inner space survive the
      // proposal — cleaning them is P03's fix and P03's approval.
      { legacyPatientId: 'p-padded', fullName: '  Dhr.  Jan  van der Berg  ', rawData: '{}' },

      // Left alone: an ordinary name with no form of address in it.
      { legacyPatientId: 'p-plain', fullName: 'Jan van der Berg', rawData: '{}' },

      // Left alone: `de Heer` is a Dutch surname, and the list is closed so
      // that this rule is never the reason a row loses one.
      { legacyPatientId: 'p-heer', fullName: 'Kees de Heer', rawData: '{}' },

      // Left alone: a title is a whole token or it is nothing. Nothing here
      // reaches inside a word to find one.
      { legacyPatientId: 'p-inside-word', fullName: 'Drsten Mrkonja', rawData: '{}' },
      { legacyPatientId: 'p-tight-comma', fullName: 'Berg,Dhr. Jan', rawData: '{}' },

      // Left alone: nothing but a salutation is a row with no name in it at
      // all, which is P08's finding and not a name to strip.
      { legacyPatientId: 'p-title-only', fullName: 'Dhr.', rawData: '{}' },
      { legacyPatientId: 'p-titles-only', fullName: '  Mevr. Drs.  ', rawData: '{}' },

      // Left alone: an absent name is P08's finding, not this rule's.
      { legacyPatientId: 'p-blank', fullName: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', fullName: '', rawData: '{}' },
      { legacyPatientId: 'p-null', fullName: null, rawData: '{}' },

      // Left alone: a salutation on another column entirely. P06 tests one
      // column (1.1.5) and this row's name carries no title.
      {
        legacyPatientId: 'p-other-column',
        fullName: 'Piet Jansen',
        city: 'Dhr. Haarlem',
        email: 'dhr.jansen@example.com',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's.
      { legacyPatientId: ' p-padded-id ', fullName: 'Sanne Bakker', rawData: '{}' },
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

  it('proposes the name without the title for every name that carries one', async () => {
    const response = await p06.run(context);

    // The value matters, not just that the rule fired: each `next` is the name
    // with the form of address taken out and the gap it opened taken with it,
    // and nothing else about the value touched. One call, every row (1.1.14),
    // and `column` is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-dhr',
        column: 'full_name',
        prev: 'Dhr. Jan van der Berg',
        // The catalogue's own answer: the name without it.
        next: 'Jan van der Berg',
      },
      {
        table: 'patient',
        legacyId: 'p-dhr-no-dot',
        column: 'full_name',
        prev: 'Dhr Anne de Wit',
        next: 'Anne de Wit',
      },
      {
        table: 'patient',
        legacyId: 'p-drs',
        column: 'full_name',
        prev: 'Drs. Lotte Smit',
        next: 'Lotte Smit',
      },
      {
        table: 'patient',
        legacyId: 'p-english-mrs',
        column: 'full_name',
        prev: 'Mrs Eva Mulder',
        next: 'Eva Mulder',
      },
      {
        table: 'patient',
        legacyId: 'p-inverted',
        column: 'full_name',
        prev: 'Berg, Dhr. Jan van der',
        // Still comma-inverted afterwards. P06 took the salutation and left the
        // order to P05 (1.1.4).
        next: 'Berg, Jan van der',
      },
      {
        table: 'patient',
        legacyId: 'p-mevr',
        column: 'full_name',
        prev: 'Mevr. Sanne Bakker',
        next: 'Sanne Bakker',
      },
      {
        table: 'patient',
        legacyId: 'p-middle',
        column: 'full_name',
        prev: 'Jan Drs.  de Vries',
        // The doubled space that followed the title was not the gap the title
        // opened — the single space in front of it was — so it survives, and
        // P03 still has its finding on this row.
        next: 'Jan  de Vries',
      },
      {
        table: 'patient',
        legacyId: 'p-mr',
        column: 'full_name',
        prev: 'Mr Piet Jansen',
        next: 'Piet Jansen',
      },
      {
        table: 'patient',
        legacyId: 'p-mr-dot',
        column: 'full_name',
        prev: 'Mr. Tom Visser',
        next: 'Tom Visser',
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'full_name',
        prev: '  Dhr.  Jan  van der Berg  ',
        // The padding and the doubled space inside the name are still there:
        // this rule takes the title and only the title (1.1.4).
        next: '  Jan  van der Berg  ',
      },
      {
        table: 'patient',
        legacyId: 'p-prof',
        column: 'full_name',
        prev: 'Prof. Karel Vos',
        next: 'Karel Vos',
      },
      {
        table: 'patient',
        legacyId: 'p-shouted',
        column: 'full_name',
        prev: 'DHR. JAN DE VRIES',
        // Still shouting afterwards. The case is P04's fix and P04's approval.
        next: 'JAN DE VRIES',
      },
      {
        table: 'patient',
        legacyId: 'p-stacked',
        column: 'full_name',
        prev: 'Dhr. Drs. Koen Bos',
        next: 'Koen Bos',
      },
      {
        table: 'patient',
        legacyId: 'p-trailing',
        column: 'full_name',
        prev: 'Marieke Peters Drs.',
        next: 'Marieke Peters',
      },
    ]);
  });

  it('addresses each finding by the row it read the name from', async () => {
    const response = await p06.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `full_name`, so the id it reports is the row's
    // own, untouched, and the stored row still holds the name it reports as
    // `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.fullName).toBe(update.prev);
    }
  });

  it('leaves a name that carries no title alone', async () => {
    const response = await p06.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // An ordinary name has nothing to take. `de Heer` is a surname and not a
    // salutation. A title has to be a whole token. A value that is nothing but
    // a title is P08's row, not a name with a title in front of it. And an
    // absent name is P08's too.
    expect(touched).not.toContain('p-plain');
    expect(touched).not.toContain('p-heer');
    expect(touched).not.toContain('p-inside-word');
    expect(touched).not.toContain('p-tight-comma');
    expect(touched).not.toContain('p-title-only');
    expect(touched).not.toContain('p-titles-only');
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');

    // And no other column is proposed against, whatever salutations it holds
    // (1.1.5) — including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('full_name');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries a proposed value', async () => {
    const response = await p06.run(context);

    // The catalogue does not mark P06 ambiguous: a form of address was never
    // part of the name, so removing it guesses nothing. The flag is rule-wide
    // (1.1.12), stated once beside the updates, and the `rule` row says the
    // same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p06.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);

      // No proposal is ever empty: a value stripped down to nothing is the row
      // this rule refuses to touch.
      expect(update.next?.trim().length).toBeGreaterThan(0);

      // And the name's own padding came through untouched, because P03 owns
      // padding: what the value opened and closed with, it still opens and
      // closes with.
      expect(/^\s*/.exec(update.next ?? '')?.[0]).toBe(/^\s*/.exec(update.prev ?? '')?.[0]);
      expect(/\s*$/.exec(update.next ?? '')?.[0]).toBe(/\s*$/.exec(update.prev ?? '')?.[0]);
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p06.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-dhr');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). The rule is self-terminating, so the applied row needs no
    // guard to keep it from being re-proposed.
    await patients.update({ legacyPatientId: 'p-dhr' }, { fullName: 'Jan van der Berg' });

    const after = await p06.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-dhr');

    await patients.update({ legacyPatientId: 'p-dhr' }, { fullName: 'Dhr. Jan van der Berg' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p06.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(25);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P06 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p06);
    expect(p06.ruleId).toBe('P06');
    expect(p06.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p06.ruleName.length).toBeGreaterThan(0);
    expect(p06.description.length).toBeGreaterThan(0);
  });
});
