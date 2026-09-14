import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i18 } from '../src/rules/catalogue/i18';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I18 — an intake weight implausible in either unit', () => {
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
      { legacyIntakeId: 'in-too-light', weight: '5.7', rawData: '{}' },
      { legacyIntakeId: 'in-too-heavy', weight: '450', rawData: '{}' },
      // Right on the floor and the ceiling: plausible, and I19's business.
      { legacyIntakeId: 'in-floor', weight: '30', rawData: '{}' },
      { legacyIntakeId: 'in-ceiling', weight: '400', rawData: '{}' },
      // Plausible and clean — I19's finding, not this one's.
      { legacyIntakeId: 'in-plausible', weight: '82', rawData: '{}' },
      // Not a clean number: I15's or I17's finding, not this one's.
      { legacyIntakeId: 'in-comma', weight: '5,5', rawData: '{}' },
      { legacyIntakeId: 'in-prose', weight: 'onbekend', rawData: '{}' },
      { legacyIntakeId: 'in-null', weight: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a clean weight outside the plausible range, proposing nothing', async () => {
    const response = await i18.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-too-light')).toEqual({
      table: 'intake',
      legacyId: 'in-too-light',
      column: 'weight',
      prev: '5.7',
      next: null,
    });
    expect(byId.get('in-too-heavy')).toEqual({
      table: 'intake',
      legacyId: 'in-too-heavy',
      column: 'weight',
      prev: '450',
      next: null,
    });

    expect(byId.has('in-floor')).toBe(false);
    expect(byId.has('in-ceiling')).toBe(false);
    expect(byId.has('in-plausible')).toBe(false);
    expect(byId.has('in-comma')).toBe(false);
    expect(byId.has('in-prose')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(i18.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i18);
  });
});
