import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i31 } from '../src/rules/catalogue/i31';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I31 — an intake weekly alcohol units value written as a range', () => {
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
      { legacyIntakeId: 'in-hyphen', alcoholUnitsWeek: '5-10', rawData: '{}' },
      { legacyIntakeId: 'in-a', alcoholUnitsWeek: '5 à 10', rawData: '{}' },
      { legacyIntakeId: 'in-plain', alcoholUnitsWeek: '10', rawData: '{}' }, // one number, I30's territory
      { legacyIntakeId: 'in-comma', alcoholUnitsWeek: '5,5', rawData: '{}' }, // no separator at all
      { legacyIntakeId: 'in-null', alcoholUnitsWeek: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a weekly alcohol units value written as a range, proposing nothing', async () => {
    const response = await i31.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-hyphen')).toEqual({
      table: 'intake',
      legacyId: 'in-hyphen',
      column: 'alcohol_units_week',
      prev: '5-10',
      next: null,
    });
    expect(byId.get('in-a')).toEqual({
      table: 'intake',
      legacyId: 'in-a',
      column: 'alcohol_units_week',
      prev: '5 à 10',
      next: null,
    });

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('in-plain');
    expect(touched).not.toContain('in-comma');
    expect(touched).not.toContain('in-null');

    expect(response.ambiguity).toBe(true);
    expect(i31.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i31);
  });
});
