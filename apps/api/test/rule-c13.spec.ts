import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { c13 } from '../src/rules/catalogue/c13';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('C13 — a consent row with no version', () => {
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
      { legacyPatientId: 'rec-null', action: 'granted', version: null, rawData: '{}' },
      { legacyPatientId: 'rec-blank', action: 'granted', version: '', rawData: '{}' },
      { legacyPatientId: 'rec-whitespace', action: 'granted', version: '   ', rawData: '{}' },
      { legacyPatientId: 'rec-clean', action: 'granted', version: 'v1', rawData: '{}' },
      // Malformed but not empty is C12's business or out of scope, not this rule's.
      { legacyPatientId: 'rec-garbage', action: 'granted', version: 'final', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports every row whose version is empty or only whitespace, proposing nothing', async () => {
    const response = await c13.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('rec-null')).toEqual({
      table: 'consent',
      legacyId: 'rec-null',
      column: 'version',
      prev: null,
      next: null,
    });
    expect(byId.get('rec-blank')).toEqual({
      table: 'consent',
      legacyId: 'rec-blank',
      column: 'version',
      prev: '',
      next: null,
    });
    expect(byId.get('rec-whitespace')).toEqual({
      table: 'consent',
      legacyId: 'rec-whitespace',
      column: 'version',
      prev: '   ',
      next: null,
    });

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('rec-clean');
    expect(touched).not.toContain('rec-garbage');

    expect(response.ambiguity).toBe(true);
    expect(c13.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(c13);
  });
});
