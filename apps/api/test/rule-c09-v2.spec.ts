import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { c09 } from '../src/rules/catalogue/c09';
import { c09V2 } from '../src/rules/catalogue/c09-v2';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/** Fixed local noon, as in v1's suite, so "future" never moves under the test. */
const TODAY = new Date('2026-09-13T12:00:00');

describe('C09 v2 — a future consent timestamp is rejected, not left for a human', () => {
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
      { legacyPatientId: 'rec-future-time', at: '2027-01-01T10:00:00', rawData: '{}' },
      { legacyPatientId: 'rec-future-date', at: '2027-01-01', rawData: '{}' },
      { legacyPatientId: 'rec-past', at: '2020-01-01', rawData: '{}' },
      { legacyPatientId: 'rec-two-way-future', at: '01/02/2031', rawData: '{}' },
      { legacyPatientId: 'rec-straddle', at: '12/01/2026', rawData: '{}' },
      { legacyPatientId: 'rec-not-a-date', at: '2020-02-30', rawData: '{}' },
      { legacyPatientId: 'rec-null', at: null, rawData: '{}' },
      { legacyPatientId: 'rec-empty', at: '', rawData: '{}' },
    ]);
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TODAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes an empty timestamp for every row v1 caught, and no other', async () => {
    const v1 = await c09.run(context);
    const v2 = await c09V2.run(context);

    expect(v2.updates.map((u) => u.legacyId).sort()).toEqual(v1.updates.map((u) => u.legacyId).sort());
    expect(v2.updates.map((u) => u.legacyId).sort()).toEqual([
      'rec-future-date',
      'rec-future-time',
      'rec-two-way-future',
    ]);

    const byId = new Map(v2.updates.map((update) => [update.legacyId, update]));
    expect(byId.get('rec-future-time')).toEqual({
      table: 'consent',
      legacyId: 'rec-future-time',
      column: 'at',
      prev: '2027-01-01T10:00:00',
      next: '',
    });
    for (const update of v2.updates) expect(update.next).toBe('');
  });

  it('is not ambiguous, and sits in the catalogue after v1', async () => {
    const response = await c09V2.run(context);
    expect(response.ambiguity).toBe(false);
    expect(c09V2.ambiguous).toBe(false);
    expect(c09V2.ruleId).toBe('C09');
    expect(c09V2.version).toBe(2);
    expect(ruleCatalogue.indexOf(c09V2)).toBeGreaterThan(ruleCatalogue.indexOf(c09));
  });
});
