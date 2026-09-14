import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p45 } from '../src/rules/catalogue/p45';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P45 — a patient row with no weight at all', () => {
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
      { legacyPatientId: 'p-null', weight: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', weight: '', rawData: '{}' },
      { legacyPatientId: 'p-blank', weight: '   ', rawData: '{}' },
      { legacyPatientId: 'p-present', weight: '82', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('flags a null, empty or whitespace-only weight, and leaves a reported one alone', async () => {
    const response = await p45.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-null')).toEqual({
      table: 'patient',
      legacyId: 'p-null',
      column: 'weight',
      prev: null,
      next: null,
    });
    expect(byId.get('p-empty')).toEqual({
      table: 'patient',
      legacyId: 'p-empty',
      column: 'weight',
      prev: '',
      next: null,
    });
    expect(byId.get('p-blank')).toEqual({
      table: 'patient',
      legacyId: 'p-blank',
      column: 'weight',
      prev: '   ',
      next: null,
    });

    expect(byId.has('p-present')).toBe(false);
    expect(response.ambiguity).toBe(true);
    expect(p45.ambiguous).toBe(true);
  });
});
