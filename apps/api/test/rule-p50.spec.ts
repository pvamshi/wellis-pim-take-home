import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p50 } from '../src/rules/catalogue/p50';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P50 — a patient height expressed in metres', () => {
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
      { legacyPatientId: 'p-metres', heightCm: '1.75', rawData: '{}' },
      { legacyPatientId: 'p-integer-metres', heightCm: '2', rawData: '{}' },
      { legacyPatientId: 'p-plausible', heightCm: '175', rawData: '{}' },
      { legacyPatientId: 'p-edge', heightCm: '3', rawData: '{}' },
      { legacyPatientId: 'p-comma', heightCm: '1,75', rawData: '{}' },
      { legacyPatientId: 'p-feet', heightCm: `5'10"`, rawData: '{}' },
      { legacyPatientId: 'p-empty', heightCm: '', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the centimetre value for a clean number under 3, and leaves the rest alone', async () => {
    const response = await p50.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-metres')).toEqual({
      table: 'patient',
      legacyId: 'p-metres',
      column: 'height_cm',
      prev: '1.75',
      next: '175',
    });
    expect(byId.get('p-integer-metres')).toEqual({
      table: 'patient',
      legacyId: 'p-integer-metres',
      column: 'height_cm',
      prev: '2',
      next: '200',
    });

    // Already plausible, exactly on the boundary, still comma-punctuated
    // (P49's), feet-and-inches (P51's), or blank (P54's).
    expect(byId.has('p-plausible')).toBe(false);
    expect(byId.has('p-edge')).toBe(false);
    expect(byId.has('p-comma')).toBe(false);
    expect(byId.has('p-feet')).toBe(false);
    expect(byId.has('p-empty')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(p50.ambiguous).toBe(false);
  });
});
