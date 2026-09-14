import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p56 } from '../src/rules/catalogue/p56';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P56 — a patient status nobody recognises', () => {
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
      { legacyPatientId: 'p-cancelled', status: 'cancelled', rawData: '{}' },
      { legacyPatientId: 'p-dutch', status: 'opgezegd', rawData: '{}' },
      { legacyPatientId: 'p-onhold', status: 'on hold', rawData: '{}' },
      { legacyPatientId: 'p-recognised', status: 'Active', rawData: '{}' },
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

  it('reports an unrecognised status with no proposed value, and leaves the rest alone', async () => {
    const response = await p56.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-cancelled')).toEqual({
      table: 'patient',
      legacyId: 'p-cancelled',
      column: 'status',
      prev: 'cancelled',
      next: null,
    });
    expect(byId.get('p-dutch')).toEqual({
      table: 'patient',
      legacyId: 'p-dutch',
      column: 'status',
      prev: 'opgezegd',
      next: null,
    });
    expect(byId.get('p-onhold')).toEqual({
      table: 'patient',
      legacyId: 'p-onhold',
      column: 'status',
      prev: 'on hold',
      next: null,
    });

    // A spelling P55 already reads, whatever its case, is not this rule's; an
    // empty or absent cell is P57's, not something nobody recognises.
    expect(byId.has('p-recognised')).toBe(false);
    expect(byId.has('p-empty')).toBe(false);
    expect(byId.has('p-null')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(p56.ambiguous).toBe(true);
  });
});
