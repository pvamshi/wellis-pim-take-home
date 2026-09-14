import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { c08 } from '../src/rules/catalogue/c08';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('C08 — a consent timestamp that is a date with no time at all', () => {
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
      { legacyPatientId: 'rec-iso-date', at: '2024-01-15', rawData: '{}' },
      { legacyPatientId: 'rec-slash-date', at: '2024/01/15', rawData: '{}' },
      { legacyPatientId: 'rec-day-first-date', at: '15-01-2024', rawData: '{}' },
      // A time attached — C07's shape to fix, not this rule's finding.
      { legacyPatientId: 'rec-with-time', at: '2024-01-15T10:30:00', rawData: '{}' },
      // Empty and null — C11's finding, not this rule's.
      { legacyPatientId: 'rec-blank', at: '   ', rawData: '{}' },
      { legacyPatientId: 'rec-null', at: null, rawData: '{}' },
      { legacyPatientId: 'rec-not-a-date', at: 'not-a-date', rawData: '{}' },
      { legacyPatientId: 'rec-bad-date', at: '2024-02-30', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports every date-only cell in a recognised shape, proposing nothing', async () => {
    const response = await c08.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    for (const [id, prev] of [
      ['rec-iso-date', '2024-01-15'],
      ['rec-slash-date', '2024/01/15'],
      ['rec-day-first-date', '15-01-2024'],
    ] as const) {
      expect(byId.get(id)).toEqual({ table: 'consent', legacyId: id, column: 'at', prev, next: null });
    }

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('rec-with-time');
    expect(touched).not.toContain('rec-blank');
    expect(touched).not.toContain('rec-null');
    expect(touched).not.toContain('rec-not-a-date');
    expect(touched).not.toContain('rec-bad-date');

    expect(response.ambiguity).toBe(true);
    expect(c08.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(c08);
  });
});
