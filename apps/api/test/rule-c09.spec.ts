import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { c09 } from '../src/rules/catalogue/c09';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/** The day every timestamp in this suite is future or past relative to.
 * Local noon, so the calendar day is the 13th of September 2026 in any
 * timezone. Fixed rather than read off the real clock, so the straddling
 * fixture below lands on the same side of "future" every time this runs. */
const TODAY = new Date('2026-09-13T12:00:00');

describe('C09 — a consent timestamp in the future', () => {
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
      // Both the US and day-first readings land in the future either way.
      { legacyPatientId: 'rec-two-way-future', at: '01/02/2031', rawData: '{}' },
      // A two-way date whose readings straddle today: the 1st of December
      // 2026 is still to come, the 12th of January 2026 has been and gone.
      { legacyPatientId: 'rec-straddle', at: '12/01/2026', rawData: '{}' },
      { legacyPatientId: 'rec-not-a-date', at: '2020-02-30', rawData: '{}' },
      { legacyPatientId: 'rec-null', at: null, rawData: '{}' },
    ]);
  });

  beforeEach(() => {
    // Only `Date` is faked: the rule reads the clock, and nothing else in the
    // suite should notice.
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

  it('reports every timestamp whose readings are all in the future, proposing nothing', async () => {
    const response = await c09.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('rec-future-time')).toEqual({
      table: 'consent',
      legacyId: 'rec-future-time',
      column: 'at',
      prev: '2027-01-01T10:00:00',
      next: null,
    });
    expect(byId.get('rec-future-date')?.next).toBeNull();
    expect(byId.get('rec-two-way-future')?.next).toBeNull();

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('rec-past');
    expect(touched).not.toContain('rec-straddle');
    expect(touched).not.toContain('rec-not-a-date');
    expect(touched).not.toContain('rec-null');

    expect(response.ambiguity).toBe(true);
    expect(c09.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(c09);
  });
});
