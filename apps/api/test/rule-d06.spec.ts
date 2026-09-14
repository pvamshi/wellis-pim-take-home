import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { d06 } from '../src/rules/catalogue/d06';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('D06 — two consent events identical in patient, type, action, timestamp and version', () => {
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
    const consents: Repository<LegacyConsent> = dataSource.getRepository(LegacyConsent);
    context = createRuleContext(dataSource.manager);

    await consents.save([
      {
        legacyPatientId: 'pat-first',
        type: 'marketing',
        action: 'granted',
        at: '2023-01-01T00:00:00Z',
        version: '1',
        rawData: '{}',
      },
      // Same five fields, logged twice — the finding.
      {
        legacyPatientId: 'pat-first',
        type: 'marketing',
        action: 'granted',
        at: '2023-01-01T00:00:00Z',
        version: '1',
        rawData: '{}',
      },
      // Same patient and type, different action — a real second event.
      {
        legacyPatientId: 'pat-first',
        type: 'marketing',
        action: 'revoked',
        at: '2023-02-01T00:00:00Z',
        version: '1',
        rawData: '{}',
      },
      // Otherwise identical, but missing a version — nothing to match on.
      {
        legacyPatientId: 'pat-second',
        type: 'marketing',
        action: 'granted',
        at: '2023-01-01T00:00:00Z',
        version: null,
        rawData: '{}',
      },
      {
        legacyPatientId: 'pat-second',
        type: 'marketing',
        action: 'granted',
        at: '2023-01-01T00:00:00Z',
        version: null,
        rawData: '{}',
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('links a later row to the first row identical in all five fields, and leaves the rest alone', async () => {
    const response = await d06.run(context);

    expect(response.duplicates).toEqual([
      {
        table: 'consent',
        duplicateLegacyId: 'pat-first',
        canonicalLegacyId: 'pat-first',
      },
    ]);
    expect(response.updates).toEqual([]);
    expect(response.ambiguity).toBe(false);
    expect(d06.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(d06);
  });
});
