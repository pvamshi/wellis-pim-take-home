import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { c04 } from '../src/rules/catalogue/c04';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('C04 — a consent type other than data_processing', () => {
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
      { legacyPatientId: 'rec-good', type: 'data_processing', rawData: '{}' },
      { legacyPatientId: 'rec-null', type: null, rawData: '{}' },
      { legacyPatientId: 'rec-blank', type: '', rawData: '{}' },
      // Padded — this rule does not trim it away, since a deviation might not
      // be noise at all.
      { legacyPatientId: 'rec-padded', type: ' data_processing ', rawData: '{}' },
      { legacyPatientId: 'rec-other', type: 'marketing', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports every row whose type is not exactly data_processing, proposing nothing', async () => {
    const response = await c04.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('rec-null')).toEqual({
      table: 'consent',
      legacyId: 'rec-null',
      column: 'type',
      prev: null,
      next: null,
    });
    expect(byId.get('rec-blank')?.prev).toBe('');
    expect(byId.get('rec-padded')?.prev).toBe(' data_processing ');
    expect(byId.get('rec-other')?.prev).toBe('marketing');

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('rec-good');

    expect(response.ambiguity).toBe(true);
    expect(c04.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(c04);
  });
});
