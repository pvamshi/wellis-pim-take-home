import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p05 } from '../src/rules/catalogue/p05';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P05 — a patient `full_name` written surname first, against a real database
 * with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P05 — a comma-inverted patient name', () => {
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
      // The catalogue's own example, and the plainest case of it.
      { legacyPatientId: 'p-catalogue', fullName: 'Berg, Jan van der', rawData: '{}' },
      { legacyPatientId: 'p-plain', fullName: 'Bakker, Sanne', rawData: '{}' },

      // The particles move with the half they were typed in, whichever side of
      // the comma that is.
      { legacyPatientId: 'p-particle-first', fullName: 'de Vries, Jan', rawData: '{}' },

      // A comma with no space after it is still an inversion.
      { legacyPatientId: 'p-tight', fullName: 'Jansen,Piet', rawData: '{}' },

      // And a space before the comma is still one. The gap either side of the
      // comma goes with the comma, because removing it removes the gap.
      { legacyPatientId: 'p-spaced-comma', fullName: 'Smit ,  Lotte', rawData: '{}' },

      // Order is all this rule fixes. The padding and the doubled inner space
      // survive the proposal — cleaning them is P03's fix and P03's approval.
      { legacyPatientId: 'p-padded', fullName: '  Berg, Jan  van der  ', rawData: '{}' },

      // Case is P04's, a salutation is P06's. This row is inverted as well, and
      // this rule un-inverts it and says nothing else about it (1.1.4).
      { legacyPatientId: 'p-shouted', fullName: 'DE WIT, ANNE-MARIE', rawData: '{}' },
      { legacyPatientId: 'p-salutation', fullName: 'Berg, Dhr. Jan van der', rawData: '{}' },

      // Left alone: no comma, so nothing says which half is the surname.
      { legacyPatientId: 'p-straight', fullName: 'Jan van der Berg', rawData: '{}' },

      // Left alone: two commas say more than "surname first", and no single
      // swap undoes them.
      { legacyPatientId: 'p-two-commas', fullName: 'Smith, John, Jr.', rawData: '{}' },

      // Left alone: a comma with nothing on one side of it is a stray
      // character, not an inversion.
      { legacyPatientId: 'p-trailing-comma', fullName: 'Berg,', rawData: '{}' },
      { legacyPatientId: 'p-leading-comma', fullName: ', Jan van der', rawData: '{}' },
      { legacyPatientId: 'p-blank-half', fullName: 'Berg,   ', rawData: '{}' },
      { legacyPatientId: 'p-comma-only', fullName: ',', rawData: '{}' },

      // Left alone: an absent name is P08's finding, not this rule's.
      { legacyPatientId: 'p-blank', fullName: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', fullName: '', rawData: '{}' },
      { legacyPatientId: 'p-null', fullName: null, rawData: '{}' },

      // Left alone: a comma on another column entirely. P05 tests one column
      // (1.1.5) and this row's name reads in the right order.
      {
        legacyPatientId: 'p-other-column',
        fullName: 'Piet Jansen',
        city: 'Haag, Den',
        email: 'piet@example.com,piet2@example.com',
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

  it('proposes the name in reading order for every comma-inverted name', async () => {
    const response = await p05.run(context);

    // The value matters, not just that the rule fired: each `next` is the given
    // names, then the surname, joined by one space, with the rest of the name
    // as it was. One call, every row (1.1.14), and `column` is the column that
    // was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-catalogue',
        column: 'full_name',
        prev: 'Berg, Jan van der',
        // The catalogue's own example, and its own answer.
        next: 'Jan van der Berg',
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'full_name',
        prev: '  Berg, Jan  van der  ',
        // The padding and the doubled space are still there: this rule changes
        // order and only order (1.1.4).
        next: '  Jan  van der Berg  ',
      },
      {
        table: 'patient',
        legacyId: 'p-particle-first',
        column: 'full_name',
        prev: 'de Vries, Jan',
        next: 'Jan de Vries',
      },
      {
        table: 'patient',
        legacyId: 'p-plain',
        column: 'full_name',
        prev: 'Bakker, Sanne',
        next: 'Sanne Bakker',
      },
      {
        table: 'patient',
        legacyId: 'p-salutation',
        column: 'full_name',
        prev: 'Berg, Dhr. Jan van der',
        // Still carrying `Dhr.` afterwards. P05 restored the order and left the
        // salutation to P06 (1.1.4).
        next: 'Dhr. Jan van der Berg',
      },
      {
        table: 'patient',
        legacyId: 'p-shouted',
        column: 'full_name',
        prev: 'DE WIT, ANNE-MARIE',
        // Still shouting afterwards. The case is P04's fix and P04's approval.
        next: 'ANNE-MARIE DE WIT',
      },
      {
        table: 'patient',
        legacyId: 'p-spaced-comma',
        column: 'full_name',
        prev: 'Smit ,  Lotte',
        // The space before the comma and the two after it went with the comma:
        // removing it removes the gap it opened.
        next: 'Lotte Smit',
      },
      {
        table: 'patient',
        legacyId: 'p-tight',
        column: 'full_name',
        prev: 'Jansen,Piet',
        next: 'Piet Jansen',
      },
    ]);
  });

  it('addresses each finding by the row it read the name from', async () => {
    const response = await p05.run(context);

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

  it('leaves a name that is not comma-inverted alone', async () => {
    const response = await p05.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // No comma means nothing said which half is the surname. Two commas say
    // more than one swap can undo. A comma with nothing on a side of it is a
    // stray character, and an absent name is P08's.
    expect(touched).not.toContain('p-straight');
    expect(touched).not.toContain('p-two-commas');
    expect(touched).not.toContain('p-trailing-comma');
    expect(touched).not.toContain('p-leading-comma');
    expect(touched).not.toContain('p-blank-half');
    expect(touched).not.toContain('p-comma-only');
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');

    // And no other column is proposed against, whatever commas it holds
    // (1.1.5) — including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('full_name');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries a proposed value', async () => {
    const response = await p05.run(context);

    // The catalogue does not mark P05 ambiguous: the comma says which half is
    // the surname, so the swap guesses nothing. The flag is rule-wide (1.1.12),
    // stated once beside the updates, and the `rule` row says the same thing
    // the response does.
    expect(response.ambiguity).toBe(false);
    expect(p05.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);

      // No comma is left in any proposal, which is exactly why the rule does
      // not match it a second time.
      expect(update.next).not.toContain(',');

      // And the name's own padding came through untouched, because P03 owns
      // padding: what the value opened and closed with, it still opens and
      // closes with.
      expect(/^\s*/.exec(update.next ?? '')?.[0]).toBe(/^\s*/.exec(update.prev ?? '')?.[0]);
      expect(/\s*$/.exec(update.next ?? '')?.[0]).toBe(/\s*$/.exec(update.prev ?? '')?.[0]);
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p05.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-catalogue');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). The rule is self-terminating, so the applied row needs no
    // guard to keep it from being re-proposed.
    await patients.update({ legacyPatientId: 'p-catalogue' }, { fullName: 'Jan van der Berg' });

    const after = await p05.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-catalogue');

    await patients.update({ legacyPatientId: 'p-catalogue' }, { fullName: 'Berg, Jan van der' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p05.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(19);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P05 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p05);
    expect(p05.ruleId).toBe('P05');
    expect(p05.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p05.ruleName.length).toBeGreaterThan(0);
    expect(p05.description.length).toBeGreaterThan(0);
  });
});
