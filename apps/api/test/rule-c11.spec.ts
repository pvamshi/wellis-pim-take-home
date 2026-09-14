import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { c11 } from '../src/rules/catalogue/c11';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('C11 — a consent row with no timestamp', () => {
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
      { legacyPatientId: 'rec-null', action: 'granted', at: null, rawData: '{}' },
      { legacyPatientId: 'rec-blank', action: 'granted', at: '', rawData: '{}' },
      { legacyPatientId: 'rec-whitespace', action: 'granted', at: '   ', rawData: '{}' },
      { legacyPatientId: 'rec-clean', action: 'granted', at: '2024-01-15T10:30:00', rawData: '{}' },
      // Malformed but not empty is C07 through C10's business, not this rule's.
      { legacyPatientId: 'rec-garbage', action: 'granted', at: 'not-a-timestamp', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports every row whose timestamp is empty or only whitespace, proposing nothing', async () => {
    const response = await c11.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('rec-null')).toEqual({
      table: 'consent',
      legacyId: 'rec-null',
      column: 'at',
      prev: null,
      next: null,
    });
    expect(byId.get('rec-blank')).toEqual({
      table: 'consent',
      legacyId: 'rec-blank',
      column: 'at',
      prev: '',
      next: null,
    });
    expect(byId.get('rec-whitespace')).toEqual({
      table: 'consent',
      legacyId: 'rec-whitespace',
      column: 'at',
      prev: '   ',
      next: null,
    });

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('rec-clean');
    expect(touched).not.toContain('rec-garbage');

    expect(response.ambiguity).toBe(true);
    expect(c11.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(c11);
  });
});
