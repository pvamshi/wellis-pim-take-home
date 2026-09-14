import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p47 } from '../src/rules/catalogue/p47';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P47 — a patient weight unit empty while weight has a value', () => {
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
      { legacyPatientId: 'p-has-unit', weight: '82', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'p-neither', weight: null, weightUnit: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('flags a blank unit only when the row reported a weight, with no proposal', async () => {
    const response = await p47.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-missing')).toEqual({
      table: 'patient',
      legacyId: 'p-missing',
      column: 'weight_unit',
      prev: null,
      next: null,
    });
    expect(byId.get('p-blank')).toEqual({
      table: 'patient',
      legacyId: 'p-blank',
      column: 'weight_unit',
      prev: '   ',
      next: null,
    });

    // Already has a unit, or has no weight either — that second one is P45's.
    expect(byId.has('p-has-unit')).toBe(false);
    expect(byId.has('p-neither')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(p47.ambiguous).toBe(true);
  });
});
