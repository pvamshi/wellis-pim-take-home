import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i30 } from '../src/rules/catalogue/i30';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I30 — an intake weekly alcohol units value written with a comma decimal', () => {
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
      { legacyIntakeId: 'in-comma', alcoholUnitsWeek: '5,5', rawData: '{}' },
      { legacyIntakeId: 'in-dot', alcoholUnitsWeek: '5.5', rawData: '{}' }, // already a dot
      { legacyIntakeId: 'in-plain', alcoholUnitsWeek: '10', rawData: '{}' }, // no comma at all
      { legacyIntakeId: 'in-range', alcoholUnitsWeek: '5-10', rawData: '{}' }, // I31's finding
      { legacyIntakeId: 'in-null', alcoholUnitsWeek: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the dot form for a comma-decimal weekly alcohol units value', async () => {
    const response = await i30.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-comma')).toEqual({
      table: 'intake',
      legacyId: 'in-comma',
      column: 'alcohol_units_week',
      prev: '5,5',
      next: '5.5',
    });

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('in-dot');
    expect(touched).not.toContain('in-plain');
    expect(touched).not.toContain('in-range');
    expect(touched).not.toContain('in-null');

    expect(response.ambiguity).toBe(false);
    expect(i30.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i30);
  });
});
