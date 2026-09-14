import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p63 } from '../src/rules/catalogue/p63';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P63 — a patient signup date that is empty', () => {
  let app: INestApplication;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let context: RuleContext;

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const dataSource = app.get(DataSource);
    const patients: Repository<LegacyPatient> = dataSource.getRepository(LegacyPatient);
    context = createRuleContext(dataSource.manager);

    await patients.save([
      { legacyPatientId: 'p-null', signupDate: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', signupDate: '', rawData: '{}' },
      { legacyPatientId: 'p-whitespace', signupDate: '  \t', rawData: '{}' },
      { legacyPatientId: 'p-present', signupDate: '2020-01-01', rawData: '{}' },
      // Even a malformed date has content, so it is left to the format rules.
      { legacyPatientId: 'p-malformed', signupDate: 'not-a-date', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a missing or whitespace-only signup date, proposing nothing', async () => {
    const response = await p63.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-null')).toEqual({
      table: 'patient',
      legacyId: 'p-null',
      column: 'signup_date',
      prev: null,
      next: null,
    });
    expect(byId.get('p-empty')?.prev).toBe('');
    expect(byId.get('p-whitespace')?.prev).toBe('  \t');

    expect(byId.has('p-present')).toBe(false);
    expect(byId.has('p-malformed')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(p63.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(p63);
  });
});
