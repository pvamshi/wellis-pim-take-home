import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i09 } from '../src/rules/catalogue/i09';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/** The day every submitted date in this suite is future or past relative to.
 * Local noon, so the calendar day is the 13th of September 2026 in any
 * timezone. Fixed rather than read off the real clock, so the straddling
 * fixture below lands on the same side of "future" every time this runs. */
const TODAY = new Date('2026-09-13T12:00:00');

describe('I09 — an intake submitted date in the future', () => {
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
    const intakes: Repository<LegacyIntake> = dataSource.getRepository(LegacyIntake);
    context = createRuleContext(dataSource.manager);

    await intakes.save([
      { legacyIntakeId: 'in-future', submittedAt: '2027-01-01', rawData: '{}' },
      { legacyIntakeId: 'in-past', submittedAt: '2020-01-01', rawData: '{}' },
      // Both the US and day-first readings land in the future either way.
      { legacyIntakeId: 'in-two-way-future', submittedAt: '01/02/2031', rawData: '{}' },
      // A two-way date whose readings straddle today: the 1st of December
      // 2026 is still to come, the 12th of January 2026 has been and gone.
      // `.every(isAfter)` says false because one reading is not future;
      // `.some(isAfter)` would say true, which is the regression this row
      // exists to catch.
      { legacyIntakeId: 'in-straddle', submittedAt: '12/01/2026', rawData: '{}' },
      { legacyIntakeId: 'in-not-date', submittedAt: '2020-02-30', rawData: '{}' },
      { legacyIntakeId: 'in-null', submittedAt: null, rawData: '{}' },
    ]);
  });

  beforeEach(() => {
    // Only `Date` is faked: the rule reads the clock, and nothing else in the
    // suite should notice. Timers the database driver or Nest may rely on
    // keep working.
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

  it('reports every submitted date whose readings are all in the future, proposing nothing', async () => {
    const response = await i09.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-future')).toEqual({
      table: 'intake',
      legacyId: 'in-future',
      column: 'submitted_at',
      prev: '2027-01-01',
      next: null,
    });
    expect(byId.get('in-two-way-future')?.next).toBeNull();

    // A past date, a straddling two-way date, a date that does not exist,
    // and no date at all.
    expect(byId.has('in-past')).toBe(false);
    expect(byId.has('in-straddle')).toBe(false);
    expect(byId.has('in-not-date')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(i09.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i09);
  });
});
