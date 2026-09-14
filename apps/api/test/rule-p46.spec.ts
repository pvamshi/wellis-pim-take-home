import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p46 } from '../src/rules/catalogue/p46';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P46 — a patient weight unit spelled a recognised but non-canonical way', () => {
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
      { legacyPatientId: 'p-kg-alt', weight: '82', weightUnit: 'KG', rawData: '{}' },
      { legacyPatientId: 'p-lbs-alt', weight: '180', weightUnit: 'pounds', rawData: '{}' },
      { legacyPatientId: 'p-clean', weight: '82', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'p-unknown', weight: '82', weightUnit: 'steen', rawData: '{}' },
      { legacyPatientId: 'p-blank', weight: '82', weightUnit: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the canonical unit for a recognised spelling, and leaves the rest alone', async () => {
    const response = await p46.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-kg-alt')).toEqual({
      table: 'patient',
      legacyId: 'p-kg-alt',
      column: 'weight_unit',
      prev: 'KG',
      next: 'kg',
    });
    expect(byId.get('p-lbs-alt')).toEqual({
      table: 'patient',
      legacyId: 'p-lbs-alt',
      column: 'weight_unit',
      prev: 'pounds',
      next: 'lbs',
    });

    // Already canonical, unrecognised (P48's), and empty (P47's).
    expect(byId.has('p-clean')).toBe(false);
    expect(byId.has('p-unknown')).toBe(false);
    expect(byId.has('p-blank')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(p46.ambiguous).toBe(false);
  });
});
