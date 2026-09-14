import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i21 } from '../src/rules/catalogue/i21';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I21 — an intake height expressed in metres', () => {
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
      { legacyIntakeId: 'in-metres', height: '1.755', rawData: '{}' },
      { legacyIntakeId: 'in-metres-bare', height: '1', rawData: '{}' },
      // At or above the metres ceiling — already centimetres, another rule's concern.
      { legacyIntakeId: 'in-ceiling', height: '3', rawData: '{}' },
      { legacyIntakeId: 'in-cm', height: '175', rawData: '{}' },
      // Not a clean number — I20's or I22's finding, not this one's.
      { legacyIntakeId: 'in-comma', height: '1,75', rawData: '{}' },
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

  it('converts a height read in metres to centimetres, and leaves the rest alone', async () => {
    const response = await i21.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-metres')).toEqual({
      table: 'intake',
      legacyId: 'in-metres',
      column: 'height',
      prev: '1.755',
      next: '175.5',
    });
    expect(byId.get('in-metres-bare')).toEqual({
      table: 'intake',
      legacyId: 'in-metres-bare',
      column: 'height',
      prev: '1',
      next: '100',
    });

    expect(byId.has('in-ceiling')).toBe(false);
    expect(byId.has('in-cm')).toBe(false);
    expect(byId.has('in-comma')).toBe(false);
    expect(byId.has('in-feet')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(i21.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i21);
  });
});
