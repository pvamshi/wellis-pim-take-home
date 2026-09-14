import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i22 } from '../src/rules/catalogue/i22';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I22 — an intake height expressed in feet and inches', () => {
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
      { legacyIntakeId: 'in-quote', height: `5'10"`, rawData: '{}' },
      { legacyIntakeId: 'in-word', height: '5 ft 10 in', rawData: '{}' },
      // Not the feet-and-inches shape — untouched by this rule.
      { legacyIntakeId: 'in-cm', height: '175', rawData: '{}' },
      { legacyIntakeId: 'in-comma', height: '1,75', rawData: '{}' },
      { legacyIntakeId: 'in-null', height: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('converts a height written in feet and inches to centimetres, and leaves the rest alone', async () => {
    const response = await i22.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-quote')).toEqual({
      table: 'intake',
      legacyId: 'in-quote',
      column: 'height',
      prev: `5'10"`,
      next: '177.8',
    });
    expect(byId.get('in-word')).toEqual({
      table: 'intake',
      legacyId: 'in-word',
      column: 'height',
      prev: '5 ft 10 in',
      next: '177.8',
    });

    expect(byId.has('in-cm')).toBe(false);
    expect(byId.has('in-comma')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(i22.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i22);
  });
});
