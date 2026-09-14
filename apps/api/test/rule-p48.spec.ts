import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p48 } from '../src/rules/catalogue/p48';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P48 — a patient weight unit nobody recognises', () => {
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
      { legacyPatientId: 'p-unknown', weight: '82', weightUnit: 'steen', rawData: '{}' },
      { legacyPatientId: 'p-pond', weight: '82', weightUnit: 'pond', rawData: '{}' },
      { legacyPatientId: 'p-known', weight: '82', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'p-alt-known', weight: '82', weightUnit: 'KG', rawData: '{}' },
      { legacyPatientId: 'p-blank', weight: '82', weightUnit: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('flags a unit outside kg and lbs, and leaves a recognised or blank one alone', async () => {
    const response = await p48.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-unknown')).toEqual({
      table: 'patient',
      legacyId: 'p-unknown',
      column: 'weight_unit',
      prev: 'steen',
      next: null,
    });
    expect(byId.get('p-pond')).toEqual({
      table: 'patient',
      legacyId: 'p-pond',
      column: 'weight_unit',
      prev: 'pond',
      next: null,
    });

    // Recognised as-is, recognised but non-canonical (P46's), and empty (P47's).
    expect(byId.has('p-known')).toBe(false);
    expect(byId.has('p-alt-known')).toBe(false);
    expect(byId.has('p-blank')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(p48.ambiguous).toBe(true);
  });
});
