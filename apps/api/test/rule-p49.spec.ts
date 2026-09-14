import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p49 } from '../src/rules/catalogue/p49';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P49 — a patient height written with a comma for the decimal point', () => {
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
      { legacyPatientId: 'p-half', heightCm: '175,5', rawData: '{}' },
      // Still fixed even though the result reads as metres — P50's business.
      { legacyPatientId: 'p-metres', heightCm: '1,75', rawData: '{}' },
      { legacyPatientId: 'p-dot', heightCm: '175.5', rawData: '{}' },
      { legacyPatientId: 'p-grouped', heightCm: '1,234', rawData: '{}' },
      { legacyPatientId: 'p-feet', heightCm: `5'10"`, rawData: '{}' },
      { legacyPatientId: 'p-empty', heightCm: '', rawData: '{}' },
      { legacyPatientId: 'p-null', heightCm: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the same number with a dot for every height written with a comma', async () => {
    const response = await p49.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-half')).toEqual({
      table: 'patient',
      legacyId: 'p-half',
      column: 'height_cm',
      prev: '175,5',
      next: '175.5',
    });
    expect(byId.get('p-metres')).toEqual({
      table: 'patient',
      legacyId: 'p-metres',
      column: 'height_cm',
      prev: '1,75',
      next: '1.75',
    });
    // Already dotted, a grouped number (P52's), the feet-and-inches shape
    // (P51's), and a blank cell (P54's) are all left alone.
    expect(byId.has('p-dot')).toBe(false);
    expect(byId.has('p-grouped')).toBe(false);
    expect(byId.has('p-feet')).toBe(false);
    expect(byId.has('p-empty')).toBe(false);
    expect(byId.has('p-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(p49.ambiguous).toBe(false);
  });
});
