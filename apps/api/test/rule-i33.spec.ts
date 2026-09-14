import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i33 } from '../src/rules/catalogue/i33';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I33 — an intake weekly alcohol units value that is negative or implausibly high', () => {
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
      { legacyIntakeId: 'in-negative', alcoholUnitsWeek: '-2', rawData: '{}' },
      { legacyIntakeId: 'in-huge', alcoholUnitsWeek: '500', rawData: '{}' },
      { legacyIntakeId: 'in-plausible', alcoholUnitsWeek: '10', rawData: '{}' },
      { legacyIntakeId: 'in-boundary', alcoholUnitsWeek: '100', rawData: '{}' }, // exactly plausible
      { legacyIntakeId: 'in-words', alcoholUnitsWeek: 'occasionally', rawData: '{}' }, // I32's territory
      { legacyIntakeId: 'in-range', alcoholUnitsWeek: '5-10', rawData: '{}' }, // I31's territory
      { legacyIntakeId: 'in-null', alcoholUnitsWeek: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a negative or implausibly high weekly alcohol units value, proposing nothing', async () => {
    const response = await i33.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-negative')).toEqual({
      table: 'intake',
      legacyId: 'in-negative',
      column: 'alcohol_units_week',
      prev: '-2',
      next: null,
    });
    expect(byId.get('in-huge')).toEqual({
      table: 'intake',
      legacyId: 'in-huge',
      column: 'alcohol_units_week',
      prev: '500',
      next: null,
    });

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('in-plausible');
    expect(touched).not.toContain('in-boundary');
    expect(touched).not.toContain('in-words');
    expect(touched).not.toContain('in-range');
    expect(touched).not.toContain('in-null');

    expect(response.ambiguity).toBe(true);
    expect(i33.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i33);
  });
});
