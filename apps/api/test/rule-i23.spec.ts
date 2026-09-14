import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i23 } from '../src/rules/catalogue/i23';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I23 — an intake height that is not a number, or is implausible', () => {
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
      { legacyIntakeId: 'in-prose', height: 'onbekend', rawData: '{}' },
      { legacyIntakeId: 'in-too-short', height: '80', rawData: '{}' },
      // The plausible range's own edges, inclusive.
      { legacyIntakeId: 'in-floor', height: '100', rawData: '{}' },
      { legacyIntakeId: 'in-ceiling', height: '250', rawData: '{}' },
      { legacyIntakeId: 'in-plausible', height: '175', rawData: '{}' },
      // Read by a neighbouring rule, not this one's.
      { legacyIntakeId: 'in-metres', height: '1.75', rawData: '{}' },
      { legacyIntakeId: 'in-comma', height: '175,5', rawData: '{}' },
      { legacyIntakeId: 'in-feet', height: "5'10\"", rawData: '{}' },
      { legacyIntakeId: 'in-null', height: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a height that cannot be parsed, or that parses but is implausible, proposing nothing', async () => {
    const response = await i23.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-prose')).toEqual({
      table: 'intake',
      legacyId: 'in-prose',
      column: 'height',
      prev: 'onbekend',
      next: null,
    });
    expect(byId.get('in-too-short')).toEqual({
      table: 'intake',
      legacyId: 'in-too-short',
      column: 'height',
      prev: '80',
      next: null,
    });

    for (const id of ['in-floor', 'in-ceiling', 'in-plausible', 'in-metres', 'in-comma', 'in-feet', 'in-null']) {
      expect(byId.has(id)).toBe(false);
    }

    expect(response.ambiguity).toBe(true);
    expect(i23.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i23);
  });
});
