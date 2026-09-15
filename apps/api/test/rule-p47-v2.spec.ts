import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p47 } from '../src/rules/catalogue/p47';
import { p47V2 } from '../src/rules/catalogue/p47-v2';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P47 v2 — a patient weight unit empty while weight has a value, proposing kg', () => {
  let app: INestApplication;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let patients: Repository<LegacyPatient>;
  let context: RuleContext;

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const dataSource = app.get(DataSource);
    patients = dataSource.getRepository(LegacyPatient);
    context = createRuleContext(dataSource.manager);

    await patients.save([
      { legacyPatientId: 'p-missing', weight: '82', weightUnit: null, rawData: '{}' },
      { legacyPatientId: 'p-blank', weight: '82', weightUnit: '   ', rawData: '{}' },
      { legacyPatientId: 'p-has-unit', weight: '82', weightUnit: 'lbs', rawData: '{}' },
      { legacyPatientId: 'p-neither', weight: null, weightUnit: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes kg for a blank unit beside a weight, and leaves any recorded unit alone', async () => {
    const response = await p47V2.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-missing')).toEqual({
      table: 'patient',
      legacyId: 'p-missing',
      column: 'weight_unit',
      prev: null,
      next: 'kg',
    });
    expect(byId.get('p-blank')).toEqual({
      table: 'patient',
      legacyId: 'p-blank',
      column: 'weight_unit',
      prev: '   ',
      next: 'kg',
    });

    // A recorded unit, pounds included, is not this rule's to change; no weight is P45's.
    expect(byId.has('p-has-unit')).toBe(false);
    expect(byId.has('p-neither')).toBe(false);

    expect(response.ambiguity).toBe(false);
  });

  it('is registered after v1, so the rule reads as not ambiguous', () => {
    expect(p47V2.version).toBe(2);
    expect(p47V2.ambiguous).toBe(false);
    expect(ruleCatalogue.indexOf(p47V2)).toBeGreaterThan(ruleCatalogue.indexOf(p47));
  });
});
