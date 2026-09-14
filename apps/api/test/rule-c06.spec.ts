import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { c06 } from '../src/rules/catalogue/c06';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('C06 — a consent action that is neither granted nor revoked', () => {
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
      { legacyPatientId: 'rec-null', action: null, rawData: '{}' },
      { legacyPatientId: 'rec-blank', action: '   ', rawData: '{}' },
      { legacyPatientId: 'rec-unrecognised', action: 'pending', rawData: '{}' },
      // A recognised spelling — C05's fix, not this rule's finding.
      { legacyPatientId: 'rec-recognised', action: 'Verleend', rawData: '{}' },
      { legacyPatientId: 'rec-canonical', action: 'granted', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports every action that matches no recognised spelling of either result, proposing nothing', async () => {
    const response = await c06.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('rec-null')).toEqual({
      table: 'consent',
      legacyId: 'rec-null',
      column: 'action',
      prev: null,
      next: null,
    });
    expect(byId.get('rec-blank')).toEqual({
      table: 'consent',
      legacyId: 'rec-blank',
      column: 'action',
      prev: '   ',
      next: null,
    });
    expect(byId.get('rec-unrecognised')).toEqual({
      table: 'consent',
      legacyId: 'rec-unrecognised',
      column: 'action',
      prev: 'pending',
      next: null,
    });

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('rec-recognised');
    expect(touched).not.toContain('rec-canonical');

    expect(response.ambiguity).toBe(true);
    expect(c06.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(c06);
  });
});
