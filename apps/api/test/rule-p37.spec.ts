import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p37 } from '../src/rules/catalogue/p37';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleUpdate } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * P37 — a patient `city` padded, spaced out, or typed in casing that is not the
 * way the place is written, against a real database with real rows in it.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** Sorted by the row's legacy id, so no assertion depends on row order. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('P37 — a patient city typed some other way than the place is written', () => {
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
      // Spacing: padded at the ends, doubled inside, and a tab where a space
      // belongs. One free-text box, three ways of typing the same town.
      { legacyPatientId: 'p-padded', city: '  Amsterdam  ', rawData: '{}' },
      { legacyPatientId: 'p-doubled', city: 'Den  Haag', rawData: '{}' },
      { legacyPatientId: 'p-tab', city: 'Den\tHaag', rawData: '{}' },

      // Casing: shouted, all lower, and the half-and-half one that P04 would
      // leave alone on a person's name. The catalogue asks this rule for any
      // casing that is not the written form.
      { legacyPatientId: 'p-shouted', city: 'ROTTERDAM', rawData: '{}' },
      { legacyPatientId: 'p-lower', city: 'utrecht', rawData: '{}' },
      { legacyPatientId: 'p-mixed', city: 'ZwOlLe', rawData: '{}' },

      // Both defects at once, which is the reason they are one rule here: this
      // row reaches `Den Haag` in one proposal and one approval.
      { legacyPatientId: 'p-both', city: '  den haag ', rawData: '{}' },

      // The connectives, which is what makes this more than capitalising every
      // word — including a name that is otherwise already capitalised.
      { legacyPatientId: 'p-connective', city: 'Bergen Op Zoom', rawData: '{}' },
      { legacyPatientId: 'p-connectives', city: 'ALPHEN AAN DEN RIJN', rawData: '{}' },

      // The `ij` digraph, at the front of the name and in the middle of one.
      { legacyPatientId: 'p-ij', city: 'ijsselstein', rawData: '{}' },
      { legacyPatientId: 'p-ij-inner', city: 'capelle aan den ijssel', rawData: '{}' },

      // The elided article, hyphenated and standing on its own.
      { legacyPatientId: 'p-elision', city: "'S-HERTOGENBOSCH", rawData: '{}' },
      { legacyPatientId: 'p-elision-space', city: "'T HARDE", rawData: '{}' },

      // A hyphen inside the name raises the word after it.
      { legacyPatientId: 'p-hyphen', city: 'oud-beijerland', rawData: '{}' },

      // An alias, lower-cased. The casing is put back and the value is still an
      // alias afterwards — which place it names is P38's fix (1.1.4).
      { legacyPatientId: 'p-alias', city: "a'dam", rawData: '{}' },

      // Not a city at all. Its spacing and casing are cleaned like anything
      // else, and afterwards it is still an address in the city column: P39's
      // finding, untouched by the tidying.
      { legacyPatientId: 'p-address', city: '  kerkstraat 12, 1234 ab utrecht ', rawData: '{}' },

      // Left alone: written the way the place is written, connectives down,
      // digraph up, elision as it stands.
      { legacyPatientId: 'p-clean', city: 'Rotterdam', rawData: '{}' },
      { legacyPatientId: 'p-den-haag', city: 'Den Haag', rawData: '{}' },
      { legacyPatientId: 'p-op-clean', city: 'Bergen op Zoom', rawData: '{}' },
      { legacyPatientId: 'p-ij-clean', city: 'IJsselstein', rawData: '{}' },
      { legacyPatientId: 'p-elision-clean', city: "'s-Hertogenbosch", rawData: '{}' },

      // Left alone: an alias already typed the way it is typed. Raising the
      // letter after the apostrophe would hand P38 `A'Dam`.
      { legacyPatientId: 'p-alias-clean', city: "A'dam", rawData: '{}' },

      // Left alone: nothing to clean, and cleaning whitespace away to nothing
      // would propose the very state P40 asks a human about.
      { legacyPatientId: 'p-blank', city: '   ', rawData: '{}' },
      { legacyPatientId: 'p-empty', city: '', rawData: '{}' },
      { legacyPatientId: 'p-null', city: null, rawData: '{}' },

      // Left alone: the shouting is on other columns entirely. P37 tests one
      // column (1.1.5) and this row's city is fine.
      {
        legacyPatientId: 'p-other-column',
        fullName: 'JAN DE VRIES',
        email: 'JAN@EXAMPLE.COM',
        city: 'Utrecht',
        rawData: '{}',
      },

      // Left alone: padding on the id is P01's fix, not this rule's.
      { legacyPatientId: ' p-padded-id ', city: 'Breda', rawData: '{}' },
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

  it('proposes the cleaned city name for every city typed some other way', async () => {
    const response = await p37.run(context);

    // The value matters, not just that the rule fired: each `next` is the city
    // with its ends trimmed, its spacing reduced to single spaces and its
    // casing put back the way the place is written. One call, every row
    // (1.1.14), and `column` is the column that was tested (1.1.5).
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'p-address',
        column: 'city',
        prev: '  kerkstraat 12, 1234 ab utrecht ',
        // Still an address afterwards, and still P39's finding. This rule tests
        // how a value is written, not whether it names a place.
        next: 'Kerkstraat 12, 1234 Ab Utrecht',
      },
      {
        table: 'patient',
        legacyId: 'p-alias',
        column: 'city',
        prev: "a'dam",
        // Nothing is raised after the apostrophe, so the alias reaches P38 as
        // the alias it is.
        next: "A'dam",
      },
      {
        table: 'patient',
        legacyId: 'p-both',
        column: 'city',
        prev: '  den haag ',
        // Both halves of the one fix, in one proposal.
        next: 'Den Haag',
      },
      {
        table: 'patient',
        legacyId: 'p-connective',
        column: 'city',
        prev: 'Bergen Op Zoom',
        // `Bergen Op Zoom` is not how the place is written, capitals or no
        // capitals.
        next: 'Bergen op Zoom',
      },
      {
        table: 'patient',
        legacyId: 'p-connectives',
        column: 'city',
        prev: 'ALPHEN AAN DEN RIJN',
        next: 'Alphen aan den Rijn',
      },
      {
        table: 'patient',
        legacyId: 'p-doubled',
        column: 'city',
        prev: 'Den  Haag',
        next: 'Den Haag',
      },
      {
        table: 'patient',
        legacyId: 'p-elision',
        column: 'city',
        prev: "'S-HERTOGENBOSCH",
        // The elision stays down and the capital lands after the hyphen.
        next: "'s-Hertogenbosch",
      },
      {
        table: 'patient',
        legacyId: 'p-elision-space',
        column: 'city',
        prev: "'T HARDE",
        next: "'t Harde",
      },
      {
        table: 'patient',
        legacyId: 'p-hyphen',
        column: 'city',
        prev: 'oud-beijerland',
        next: 'Oud-Beijerland',
      },
      {
        table: 'patient',
        legacyId: 'p-ij',
        column: 'city',
        prev: 'ijsselstein',
        // `Ijsselstein` would be the digraph split in half.
        next: 'IJsselstein',
      },
      {
        table: 'patient',
        legacyId: 'p-ij-inner',
        column: 'city',
        prev: 'capelle aan den ijssel',
        next: 'Capelle aan den IJssel',
      },
      {
        table: 'patient',
        legacyId: 'p-lower',
        column: 'city',
        prev: 'utrecht',
        next: 'Utrecht',
      },
      {
        table: 'patient',
        legacyId: 'p-mixed',
        column: 'city',
        prev: 'ZwOlLe',
        // Not "entirely" either case, which P04 requires of a person's name and
        // this rule does not require of a place.
        next: 'Zwolle',
      },
      {
        table: 'patient',
        legacyId: 'p-padded',
        column: 'city',
        prev: '  Amsterdam  ',
        next: 'Amsterdam',
      },
      {
        table: 'patient',
        legacyId: 'p-shouted',
        column: 'city',
        prev: 'ROTTERDAM',
        next: 'Rotterdam',
      },
      {
        table: 'patient',
        legacyId: 'p-tab',
        column: 'city',
        prev: 'Den\tHaag',
        // A tab is spacing, and the separator it is replaced with is a plain
        // space.
        next: 'Den Haag',
      },
    ]);
  });

  it('addresses each finding by the row it read the city from', async () => {
    const response = await p37.run(context);

    // `legacyId` is how the persistence and apply layers find the data row
    // (1.1.3). This rule tests `city`, so the id it reports is the row's own,
    // untouched, and the stored row still holds the value it reports as `prev`.
    for (const update of response.updates) {
      const stored = await patients.find({ where: { legacyPatientId: update.legacyId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.city).toBe(update.prev);
    }
  });

  it('leaves a city already written that way, and an empty one, alone', async () => {
    const response = await p37.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    // Nothing to propose when the value comes back out of the clean unchanged —
    // including the connective that is already down, the digraph that is
    // already up, the elision as it stands, and the alias typed as an alias.
    expect(touched).not.toContain('p-clean');
    expect(touched).not.toContain('p-den-haag');
    expect(touched).not.toContain('p-op-clean');
    expect(touched).not.toContain('p-ij-clean');
    expect(touched).not.toContain('p-elision-clean');
    expect(touched).not.toContain('p-alias-clean');

    // An empty cell, and one that cleans away to nothing, are P40's finding.
    expect(touched).not.toContain('p-blank');
    expect(touched).not.toContain('p-empty');
    expect(touched).not.toContain('p-null');

    // And no other column is proposed against, however loudly it shouts
    // (1.1.5) — including the padded legacy id, which is P01's.
    expect(touched).not.toContain('p-other-column');
    expect(touched).not.toContain(' p-padded-id ');
    for (const update of response.updates) {
      expect(update.column).toBe('city');
      expect(update.table).toBe('patient');
    }
  });

  it('is not ambiguous, and every finding carries a proposed value', async () => {
    const response = await p37.run(context);

    // The catalogue does not mark P37 ambiguous: spacing and casing carry no
    // information about which place the cell names. The flag is rule-wide
    // (1.1.12), stated once beside the updates, and the `rule` row says the
    // same thing the response does.
    expect(response.ambiguity).toBe(false);
    expect(p37.ambiguous).toBe(false);
    expect(response.updates.length).toBeGreaterThan(0);

    for (const update of response.updates) {
      expect(update.next).not.toBeNull();
      expect(update.next).not.toBe(update.prev);

      // No proposal is ever the empty city P40 asks about.
      expect(update.next?.length).toBeGreaterThan(0);

      // Every proposal is already clean, which is exactly why the rule does not
      // match it a second time: no padding, no run of spacing, and no word left
      // in a casing the rule would change.
      expect(update.next).toBe(update.next?.trim());
      expect(update.next).not.toMatch(/\s\s/);
    }
  });

  it('stops matching once its proposal is applied', async () => {
    const before = await p37.run(context);
    expect(before.updates.map((update) => update.legacyId)).toContain('p-both');

    // What approving the finding does: write `next` into the column the rule
    // tested (1.1.5). The rule is self-terminating, so the applied row needs no
    // guard to keep it from being re-proposed.
    await patients.update({ legacyPatientId: 'p-both' }, { city: 'Den Haag' });

    const after = await p37.run(context);
    expect(after.updates.map((update) => update.legacyId)).not.toContain('p-both');

    await patients.update({ legacyPatientId: 'p-both' }, { city: '  den haag ' });
  });

  it('writes nothing while it runs', async () => {
    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    await p37.run(context);

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // 1.1.2: a rule writes nothing to any data table and nothing to any rule
    // table. Compared column by column, so a rewritten value anywhere shows up.
    expect(before).toHaveLength(27);
    expect(after).toEqual(before);

    const [counted] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );
    expect(counted?.rows).toBe(0);
  });

  it('is registered in the catalogue as P37 version 1', () => {
    // `just rules-sync` reads this list to make the `rule` and `rule_version`
    // tables match the code (1.1.1), so an unregistered rule never runs.
    expect(ruleCatalogue).toContain(p37);
    expect(p37.ruleId).toBe('P37');
    expect(p37.version).toBe(1);

    // The description is what a human reads on the rules screen (1.2.3), so it
    // has to be a sentence about the row, not a note to a developer.
    expect(p37.ruleName.length).toBeGreaterThan(0);
    expect(p37.description.length).toBeGreaterThan(0);
  });
});
