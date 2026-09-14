import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p52 } from '../src/rules/catalogue/p52';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P52 — a patient height that is not a number at all', () => {
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
      { legacyPatientId: 'p-prose', heightCm: 'onbekend', rawData: '{}' },
      { legacyPatientId: 'p-grouped', heightCm: '1,234', rawData: '{}' },
      { legacyPatientId: 'p-clean', heightCm: '175', rawData: '{}' },
      { legacyPatientId: 'p-comma', heightCm: '175,5', rawData: '{}' },
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

  it('flags prose and a grouped comma, and leaves the rest to their own rules', async () => {
    const response = await p52.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-prose')).toEqual({
      table: 'patient',
      legacyId: 'p-prose',
      column: 'height_cm',
      prev: 'onbekend',
      next: null,
    });
    expect(byId.get('p-grouped')).toEqual({
      table: 'patient',
      legacyId: 'p-grouped',
      column: 'height_cm',
      prev: '1,234',
      next: null,
    });

    // Already clean, or already read by a neighbouring rule with a fix.
    expect(byId.has('p-clean')).toBe(false);
    expect(byId.has('p-comma')).toBe(false);
    expect(byId.has('p-feet')).toBe(false);
    expect(byId.has('p-empty')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(p52.ambiguous).toBe(true);
  });
});
