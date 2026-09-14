import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p55 } from '../src/rules/catalogue/p55';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P55 — a recognised spelling of a patient status, made canonical', () => {
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
      { legacyPatientId: 'p-title', status: 'Active', rawData: '{}' },
      { legacyPatientId: 'p-dutch-upper', status: 'ACTIEF', rawData: '{}' },
      { legacyPatientId: 'p-dutch-paused', status: 'gepauzeerd', rawData: '{}' },
      { legacyPatientId: 'p-churned-title', status: 'Churned', rawData: '{}' },
      { legacyPatientId: 'p-canonical', status: 'active', rawData: '{}' },
      { legacyPatientId: 'p-unrecognised', status: 'cancelled', rawData: '{}' },
      { legacyPatientId: 'p-empty', status: '', rawData: '{}' },
      { legacyPatientId: 'p-null', status: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the canonical stage for a recognised spelling, and leaves the rest alone', async () => {
    const response = await p55.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-title')).toEqual({
      table: 'patient',
      legacyId: 'p-title',
      column: 'status',
      prev: 'Active',
      next: 'active',
    });
    expect(byId.get('p-dutch-upper')).toEqual({
      table: 'patient',
      legacyId: 'p-dutch-upper',
      column: 'status',
      prev: 'ACTIEF',
      next: 'active',
    });
    expect(byId.get('p-dutch-paused')).toEqual({
      table: 'patient',
      legacyId: 'p-dutch-paused',
      column: 'status',
      prev: 'gepauzeerd',
      next: 'paused',
    });
    expect(byId.get('p-churned-title')).toEqual({
      table: 'patient',
      legacyId: 'p-churned-title',
      column: 'status',
      prev: 'Churned',
      next: 'churned',
    });

    // Already canonical, a value nobody recognises (P56's), and empty or
    // absent (P57's) are all walked past.
    expect(byId.has('p-canonical')).toBe(false);
    expect(byId.has('p-unrecognised')).toBe(false);
    expect(byId.has('p-empty')).toBe(false);
    expect(byId.has('p-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(p55.ambiguous).toBe(false);
  });
});
