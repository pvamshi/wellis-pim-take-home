import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { c07 } from '../src/rules/catalogue/c07';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('C07 — a consent timestamp that is year first but not ISO', () => {
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
      { legacyPatientId: 'rec-slash', at: '2024/01/15 10:30:00', rawData: '{}' },
      { legacyPatientId: 'rec-space', at: '2024-01-15 10:30:00', rawData: '{}' },
      // No seconds — defaulted to :00.
      { legacyPatientId: 'rec-no-seconds', at: '2024-01-15 10:30', rawData: '{}' },
      // Already exactly canonical — nothing to fix.
      { legacyPatientId: 'rec-canonical', at: '2024-01-15T10:30:00', rawData: '{}' },
      // No time at all — C08's finding.
      { legacyPatientId: 'rec-date-only', at: '2024-01-15', rawData: '{}' },
      { legacyPatientId: 'rec-null', at: null, rawData: '{}' },
      // Day first, not year first — out of this rule's shape entirely.
      { legacyPatientId: 'rec-day-first', at: '15/01/2024 10:30:00', rawData: '{}' },
      // A month that cannot exist, even though it is written year first.
      { legacyPatientId: 'rec-bad-month', at: '2024-13-01 10:30:00', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the ISO timestamp for a year-first cell that is not already ISO', async () => {
    const response = await c07.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    for (const [id, prev, next] of [
      ['rec-slash', '2024/01/15 10:30:00', '2024-01-15T10:30:00'],
      ['rec-space', '2024-01-15 10:30:00', '2024-01-15T10:30:00'],
      ['rec-no-seconds', '2024-01-15 10:30', '2024-01-15T10:30:00'],
    ] as const) {
      expect(byId.get(id)).toEqual({ table: 'consent', legacyId: id, column: 'at', prev, next });
    }

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('rec-canonical');
    expect(touched).not.toContain('rec-date-only');
    expect(touched).not.toContain('rec-null');
    expect(touched).not.toContain('rec-day-first');
    expect(touched).not.toContain('rec-bad-month');

    expect(response.ambiguity).toBe(false);
    expect(c07.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(c07);
  });
});
