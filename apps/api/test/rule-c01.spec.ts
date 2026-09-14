import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { c01 } from '../src/rules/catalogue/c01';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('C01 — a consent patient id with whitespace around it', () => {
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
      { legacyPatientId: ' rec-lead', action: 'granted', rawData: '{}' },
      { legacyPatientId: 'rec-trail ', action: 'granted', rawData: '{}' },
      { legacyPatientId: 'rec-clean', action: 'granted', rawData: '{}' },
      { legacyPatientId: 'rec inner', action: 'granted', rawData: '{}' },
      // Trims away to nothing — C03's finding, not invented here.
      { legacyPatientId: '   ', action: 'granted', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the trimmed patient id, addressed by the untrimmed id, and leaves the rest alone', async () => {
    const response = await c01.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get(' rec-lead')).toEqual({
      table: 'consent',
      legacyId: ' rec-lead',
      column: 'patient_legacy_id',
      prev: ' rec-lead',
      next: 'rec-lead',
    });
    expect(byId.get('rec-trail ')?.next).toBe('rec-trail');

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('rec-clean');
    expect(touched).not.toContain('rec inner');
    expect(touched).not.toContain('   ');

    expect(response.ambiguity).toBe(false);
    expect(c01.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(c01);
  });
});
