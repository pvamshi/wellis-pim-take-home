import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i19 } from '../src/rules/catalogue/i19';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I19 — an intake weight with no unit column to say what it is measured in', () => {
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
      { legacyIntakeId: 'in-plausible', weight: '82', rawData: '{}' },
      // The plausible range's own edges, inclusive.
      { legacyIntakeId: 'in-floor', weight: '30', rawData: '{}' },
      { legacyIntakeId: 'in-ceiling', weight: '400', rawData: '{}' },
      // Outside the plausible range — I18's finding, not this one's.
      { legacyIntakeId: 'in-too-light', weight: '5.7', rawData: '{}' },
      { legacyIntakeId: 'in-too-heavy', weight: '450', rawData: '{}' },
      // Not a clean number: I15's, I16's or I17's finding, not this one's.
      { legacyIntakeId: 'in-comma', weight: '82,5', rawData: '{}' },
      { legacyIntakeId: 'in-unit', weight: '82 kg', rawData: '{}' },
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

  it('reports a clean, plausible weight with no unit to check it against, proposing nothing', async () => {
    const response = await i19.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-plausible')).toEqual({
      table: 'intake',
      legacyId: 'in-plausible',
      column: 'weight',
      prev: '82',
      next: null,
    });
    expect(byId.get('in-floor')).toEqual({
      table: 'intake',
      legacyId: 'in-floor',
      column: 'weight',
      prev: '30',
      next: null,
    });
    expect(byId.get('in-ceiling')).toEqual({
      table: 'intake',
      legacyId: 'in-ceiling',
      column: 'weight',
      prev: '400',
      next: null,
    });

    expect(byId.has('in-too-light')).toBe(false);
    expect(byId.has('in-too-heavy')).toBe(false);
    expect(byId.has('in-comma')).toBe(false);
    expect(byId.has('in-unit')).toBe(false);
    expect(byId.has('in-prose')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(i19.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i19);
  });
});
