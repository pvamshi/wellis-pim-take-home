import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { c03 } from '../src/rules/catalogue/c03';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('C03 — a consent row with no patient id', () => {
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
      { legacyPatientId: '', action: 'granted', rawData: '{}' },
      { legacyPatientId: '   ', action: 'granted', rawData: '{}' },
      { legacyPatientId: 'rec-clean', action: 'granted', rawData: '{}' },
      // Padded but addressable is C01's fix, not this rule's finding.
      { legacyPatientId: ' rec-lead', action: 'granted', rawData: '{}' },
      // Real content matching no patient is C02's finding, not this rule's.
      { legacyPatientId: 'rec-missing', action: 'granted', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports every row whose patient id is empty or only whitespace, proposing nothing', async () => {
    const response = await c03.run(context);
    const byPrev = new Map(response.updates.map((update) => [JSON.stringify(update.prev), update]));

    expect(byPrev.get(JSON.stringify(''))).toEqual({
      table: 'consent',
      legacyId: '',
      column: 'patient_legacy_id',
      prev: '',
      next: null,
    });
    expect(byPrev.get(JSON.stringify('   '))).toEqual({
      table: 'consent',
      legacyId: '   ',
      column: 'patient_legacy_id',
      prev: '   ',
      next: null,
    });

    const touched = response.updates.map((update) => update.prev);
    expect(touched).not.toContain('rec-clean');
    expect(touched).not.toContain(' rec-lead');
    expect(touched).not.toContain('rec-missing');

    expect(response.ambiguity).toBe(true);
    expect(c03.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(c03);
  });
});
