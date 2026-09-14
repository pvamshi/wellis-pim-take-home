import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i17 } from '../src/rules/catalogue/i17';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I17 — an intake weight that is not a number', () => {
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
      { legacyIntakeId: 'in-prose', weight: 'onbekend', rawData: '{}' },
      { legacyIntakeId: 'in-double-comma', weight: '1,234,5', rawData: '{}' },
      // Readable by a neighbour — I15's finding, not this one's.
      { legacyIntakeId: 'in-comma', weight: '82,5', rawData: '{}' },
      // Readable by a neighbour — I16's finding, not this one's.
      { legacyIntakeId: 'in-unit', weight: '82 kg', rawData: '{}' },
      // A clean number, however implausible, reads fine — I18's business.
      { legacyIntakeId: 'in-implausible', weight: '5.7', rawData: '{}' },
      { legacyIntakeId: 'in-null', weight: null, rawData: '{}' },
      { legacyIntakeId: 'in-blank', weight: '   ', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a weight that reads as no number at all, proposing nothing', async () => {
    const response = await i17.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-prose')).toEqual({
      table: 'intake',
      legacyId: 'in-prose',
      column: 'weight',
      prev: 'onbekend',
      next: null,
    });
    expect(byId.get('in-double-comma')).toEqual({
      table: 'intake',
      legacyId: 'in-double-comma',
      column: 'weight',
      prev: '1,234,5',
      next: null,
    });

    expect(byId.has('in-comma')).toBe(false);
    expect(byId.has('in-unit')).toBe(false);
    expect(byId.has('in-implausible')).toBe(false);
    expect(byId.has('in-null')).toBe(false);
    expect(byId.has('in-blank')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(i17.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i17);
  });
});
