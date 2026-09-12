import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext, RuleFunction, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry, UnregisteredRuleError } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * What a rule is handed, against a real database. Fake rules only — writing
 * rules is not this body of work.
 */

/** A row of `legacy_patient` as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** A patient row the query rule reads back through raw SQL. */
interface PatientPhoneRow {
  legacy_id: string;
  phone: string | null;
}

/**
 * A fake rule that reads the whole patient table and proposes the international
 * form of every Dutch number still written the old way.
 */
const fakePhoneRule: RuleFunction = async (context: RuleContext) => {
  const patients = await context.find(LegacyPatient);

  return {
    ambiguity: false,
    updates: patients
      .filter((patient) => patient.phone?.startsWith('06') === true)
      .map((patient) => ({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'phone',
        prev: patient.phone,
        next: `+31${patient.phone?.slice(1) ?? ''}`,
      })),
  };
};

/**
 * A fake rule whose question spans two tables (1.1.6): an intake pointing at a
 * patient id no patient row carries. It cannot say what the link should have
 * been, so it is ambiguous (1.1.12) and proposes nothing.
 */
const fakeOrphanIntakeRule: RuleFunction = async (context: RuleContext) => {
  const patients = await context.find(LegacyPatient);
  const intakes = await context.find(LegacyIntake);
  const knownPatientIds = new Set(patients.map((patient) => patient.legacyPatientId));

  return {
    ambiguity: true,
    updates: intakes
      .filter((intake) => intake.legacyPatientId !== null)
      .filter((intake) => !knownPatientIds.has(intake.legacyPatientId as string))
      .map((intake) => ({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'legacy_patient_id',
        prev: intake.legacyPatientId,
        next: null,
      })),
  };
};

/** The same phone question, asked as SQL instead of as a table read. */
const fakeQueryRule: RuleFunction = async (context: RuleContext) => {
  const rows = await context.query<PatientPhoneRow>(
    `SELECT legacy_id, phone FROM legacy_patient WHERE phone LIKE ? ORDER BY legacy_id`,
    ['06%'],
  );

  return {
    ambiguity: false,
    updates: rows.map((row) => ({
      table: 'patient' as const,
      legacyId: row.legacy_id,
      column: 'phone',
      prev: row.phone,
      next: `+31${row.phone?.slice(1) ?? ''}`,
    })),
  };
};

/** Sorted, so neither assertion depends on the order rows come back in. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

describe('the context a rule is given', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let patients: Repository<LegacyPatient>;
  let intakes: Repository<LegacyIntake>;
  let context: RuleContext;
  let registry: RuleRegistry;

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
    intakes = dataSource.getRepository(LegacyIntake);
    context = createRuleContext(dataSource.manager);

    registry = new RuleRegistry([
      { ruleId: 'R-PHONE', version: 1, run: fakePhoneRule },
      { ruleId: 'R-ORPHAN-INTAKE', version: 1, run: fakeOrphanIntakeRule },
      { ruleId: 'R-PHONE-SQL', version: 1, run: fakeQueryRule },
    ]);

    await patients.save([
      { legacyPatientId: 'P-1', phone: '0612345678', city: 'Utrecht', rawData: '{"id":"P-1"}' },
      { legacyPatientId: 'P-2', phone: '+31612345679', city: 'Amsterdam', rawData: '{"id":"P-2"}' },
      { legacyPatientId: 'P-3', phone: '0698765432', city: 'Rotterdam', rawData: '{"id":"P-3"}' },
      { legacyPatientId: 'P-4', phone: null, city: 'Den Haag', rawData: '{"id":"P-4"}' },
    ]);

    await intakes.save([
      { legacyIntakeId: 'I-1', legacyPatientId: 'P-1', rawData: '{"id":"I-1"}' },
      { legacyIntakeId: 'I-2', legacyPatientId: 'P-404', rawData: '{"id":"I-2"}' },
      { legacyIntakeId: 'I-3', legacyPatientId: null, rawData: '{"id":"I-3"}' },
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

  it('reads a whole legacy table through find', async () => {
    const response = await registry.run('R-PHONE', 1, context);

    // Every row of the table, in one call, and one update per offending row
    // (1.1.14). P-2 is already international and P-4 has no number, so neither
    // appears.
    expect(byLegacyId(response.updates)).toEqual([
      {
        table: 'patient',
        legacyId: 'P-1',
        column: 'phone',
        prev: '0612345678',
        next: '+31612345678',
      },
      {
        table: 'patient',
        legacyId: 'P-3',
        column: 'phone',
        prev: '0698765432',
        next: '+31698765432',
      },
    ]);
  });

  it('reads two legacy tables in one run, so a rule can span them', async () => {
    const response = await registry.run('R-ORPHAN-INTAKE', 1, context);

    // The finding needs both tables to exist: an intake id is only an orphan
    // relative to the set of patient ids (1.1.6). It is still field-shaped
    // (1.1.7) — a link is a value in a column like any other.
    expect(response.ambiguity).toBe(true);
    expect(byLegacyId(response.updates)).toEqual([
      { table: 'intake', legacyId: 'I-2', column: 'legacy_patient_id', prev: 'P-404', next: null },
    ]);
  });

  it('runs a parameterised read query and gets the matching rows back', async () => {
    const response = await registry.run('R-PHONE-SQL', 1, context);

    // 1.1.2: a rule may read and run DB queries. The SQL route reaches the same
    // two rows the table read did.
    expect(byLegacyId(response.updates).map((update) => update.legacyId)).toEqual(['P-1', 'P-3']);
  });

  it('returns rows straight from the database, not a cached copy', async () => {
    await patients.save({
      legacyPatientId: 'P-5',
      phone: '0611111111',
      city: 'Eindhoven',
      rawData: '{"id":"P-5"}',
    });

    const response = await registry.run('R-PHONE', 1, context);

    // The runner runs against the current data, not a snapshot: a row written
    // after the context was built is visible to the next call.
    expect(byLegacyId(response.updates).map((update) => update.legacyId)).toEqual([
      'P-1',
      'P-3',
      'P-5',
    ]);

    await patients.delete({ legacyPatientId: 'P-5' });
  });

  it('leaves every legacy row and every rule table untouched when rules run', async () => {
    const before = {
      patient: await dataSource.query<StoredRow[]>(
        `SELECT * FROM legacy_patient ORDER BY legacy_id`,
      ),
      intake: await dataSource.query<StoredRow[]>(`SELECT * FROM legacy_intake ORDER BY intake_id`),
    };

    await registry.run('R-PHONE', 1, context);
    await registry.run('R-ORPHAN-INTAKE', 1, context);
    await registry.run('R-PHONE-SQL', 1, context);

    const after = {
      patient: await dataSource.query<StoredRow[]>(
        `SELECT * FROM legacy_patient ORDER BY legacy_id`,
      ),
      intake: await dataSource.query<StoredRow[]>(`SELECT * FROM legacy_intake ORDER BY intake_id`),
    };

    // The comparison has something to compare: two tables' worth of seeded rows
    // and the phone values the rules proposed changes to.
    expect(before.patient).toHaveLength(4);
    expect(before.intake).toHaveLength(3);
    expect(before.patient.map((row) => row['phone'])).toContain('0612345678');

    // 1.1.2: nothing written to any data table. Read column by column, so a
    // rewritten value anywhere in any row shows up.
    expect(after).toEqual(before);

    // And nothing written to any rule table either. Turning a response into
    // rule rows belongs to the persistence layer (1.1.3), which is not this.
    for (const table of ['legacy_patient_rule', 'legacy_intake_rule', 'legacy_consent_rule']) {
      const [counted] = await dataSource.query<{ rows: number }[]>(
        `SELECT COUNT(*) AS rows FROM ${table}`,
      );

      expect(counted?.rows).toBe(0);
    }
  });

  it('hands a rule find and query and no way whatsoever to write', () => {
    expect(Object.getOwnPropertyNames(context).sort()).toEqual(['find', 'query']);

    // The no-write property is structural, not a promise rule code keeps: there
    // is no write method to call and no manager, repository or DataSource to
    // reach one through (1.1.2).
    const probe = context as unknown as Record<string, unknown>;
    const writePaths = [
      'manager',
      'entityManager',
      'dataSource',
      'connection',
      'repository',
      'getRepository',
      'createQueryBuilder',
      'transaction',
      'save',
      'insert',
      'update',
      'upsert',
      'delete',
      'remove',
      'softDelete',
      'clear',
    ];

    for (const path of writePaths) {
      expect(probe[path]).toBeUndefined();
    }

    // Frozen, so a rule cannot bolt one on either.
    expect(Object.isFrozen(context)).toBe(true);
  });

  it('provides the registry through the Nest container, built from the catalogue', () => {
    const provided = moduleRef.get(RuleRegistry);

    // What T3.2's runner will inject. The catalogue ships empty, so it resolves
    // nothing yet — and says so rather than returning undefined.
    expect(provided).toBeInstanceOf(RuleRegistry);
    expect(() => provided.get('R-PHONE', 1)).toThrow(UnregisteredRuleError);
  });
});
