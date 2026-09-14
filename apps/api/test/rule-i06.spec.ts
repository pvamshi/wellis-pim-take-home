import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i06 } from '../src/rules/catalogue/i06';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I06 — an intake submitted date that is US-style with a certain order', () => {
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
      { legacyIntakeId: 'in-certain', submittedAt: '02/16/2023', rawData: '{}' },
      { legacyIntakeId: 'in-both-le12', submittedAt: '03/04/2023', rawData: '{}' },
      { legacyIntakeId: 'in-dash', submittedAt: '14-08-2023', rawData: '{}' },
      { legacyIntakeId: 'in-no-month', submittedAt: '13/25/1990', rawData: '{}' },
      { legacyIntakeId: 'in-no-such-day', submittedAt: '02/30/2023', rawData: '{}' },
      { legacyIntakeId: 'in-iso', submittedAt: '2023-02-16', rawData: '{}' },
      { legacyIntakeId: 'in-null', submittedAt: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the ISO date for a certain-order US-style date, and leaves the rest alone', async () => {
    const response = await i06.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-certain')).toEqual({
      table: 'intake',
      legacyId: 'in-certain',
      column: 'submitted_at',
      prev: '02/16/2023',
      next: '2023-02-16',
    });

    // Both numbers 12 or under, dash-spelled (I07's), no valid month or day
    // either way, already ISO, and no date at all.
    expect(byId.has('in-both-le12')).toBe(false);
    expect(byId.has('in-dash')).toBe(false);
    expect(byId.has('in-no-month')).toBe(false);
    expect(byId.has('in-no-such-day')).toBe(false);
    expect(byId.has('in-iso')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(i06.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i06);
  });
});
