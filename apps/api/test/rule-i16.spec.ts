import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i16 } from '../src/rules/catalogue/i16';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I16 — an intake weight with its unit written into the value', () => {
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
      { legacyIntakeId: 'in-kg', weight: '82 kg', rawData: '{}' },
      { legacyIntakeId: 'in-lbs-tight', weight: '180lbs', rawData: '{}' },
      // A comma decimal is I15's finding, not this one's.
      { legacyIntakeId: 'in-comma', weight: '82,5 kg', rawData: '{}' },
      // Already a bare number.
      { legacyIntakeId: 'in-bare', weight: '82', rawData: '{}' },
      // Not one of the recognised spellings — left whole for a human.
      { legacyIntakeId: 'in-unrecognised-unit', weight: '82 steen', rawData: '{}' },
      { legacyIntakeId: 'in-null', weight: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the number alone for a value carrying its unit, and leaves the rest alone', async () => {
    const response = await i16.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-kg')).toEqual({
      table: 'intake',
      legacyId: 'in-kg',
      column: 'weight',
      prev: '82 kg',
      next: '82',
    });
    expect(byId.get('in-lbs-tight')).toEqual({
      table: 'intake',
      legacyId: 'in-lbs-tight',
      column: 'weight',
      prev: '180lbs',
      next: '180',
    });

    expect(byId.has('in-comma')).toBe(false);
    expect(byId.has('in-bare')).toBe(false);
    expect(byId.has('in-unrecognised-unit')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(i16.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i16);
  });
});
