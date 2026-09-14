import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p53 } from '../src/rules/catalogue/p53';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P53 — a patient height implausible after cleaning', () => {
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
      { legacyPatientId: 'p-low', heightCm: '80', rawData: '{}' },
      { legacyPatientId: 'p-high', heightCm: '300', rawData: '{}' },
      { legacyPatientId: 'p-ok', heightCm: '175', rawData: '{}' },
      { legacyPatientId: 'p-edge-low', heightCm: '100', rawData: '{}' },
      { legacyPatientId: 'p-edge-high', heightCm: '250', rawData: '{}' },
      { legacyPatientId: 'p-metres', heightCm: '1.75', rawData: '{}' },
      { legacyPatientId: 'p-comma', heightCm: '80,5', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('flags a clean number under 100 or over 250, and leaves a plausible or unclean one alone', async () => {
    const response = await p53.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-low')).toEqual({
      table: 'patient',
      legacyId: 'p-low',
      column: 'height_cm',
      prev: '80',
      next: null,
    });
    expect(byId.get('p-high')).toEqual({
      table: 'patient',
      legacyId: 'p-high',
      column: 'height_cm',
      prev: '300',
      next: null,
    });

    // Plausible, exactly on a boundary, under 3 (P50's), or not a clean
    // number at all (P49's) — none of those are this rule's business.
    expect(byId.has('p-ok')).toBe(false);
    expect(byId.has('p-edge-low')).toBe(false);
    expect(byId.has('p-edge-high')).toBe(false);
    expect(byId.has('p-metres')).toBe(false);
    expect(byId.has('p-comma')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(p53.ambiguous).toBe(true);
  });
});
