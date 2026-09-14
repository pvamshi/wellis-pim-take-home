import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p57 } from '../src/rules/catalogue/p57';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P57 — a patient row with no status at all', () => {
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
      { legacyPatientId: 'p-null', status: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', status: '', rawData: '{}' },
      { legacyPatientId: 'p-whitespace', status: '   ', rawData: '{}' },
      { legacyPatientId: 'p-present', status: 'active', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('flags a null or blank status, and leaves a present one alone', async () => {
    const response = await p57.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-null')).toEqual({
      table: 'patient',
      legacyId: 'p-null',
      column: 'status',
      prev: null,
      next: null,
    });
    expect(byId.get('p-empty')).toEqual({
      table: 'patient',
      legacyId: 'p-empty',
      column: 'status',
      prev: '',
      next: null,
    });
    expect(byId.get('p-whitespace')).toEqual({
      table: 'patient',
      legacyId: 'p-whitespace',
      column: 'status',
      prev: '   ',
      next: null,
    });

    expect(byId.has('p-present')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(p57.ambiguous).toBe(true);
  });
});
