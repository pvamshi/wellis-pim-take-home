import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i34 } from '../src/rules/catalogue/i34';
import { i34V2 } from '../src/rules/catalogue/i34-v2';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I34 v2 — an empty weekly alcohol value, now asked for in millilitres', () => {
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
      { legacyIntakeId: 'in-null', alcoholUnitsWeek: null, rawData: '{}' },
      { legacyIntakeId: 'in-empty', alcoholUnitsWeek: '', rawData: '{}' },
      { legacyIntakeId: 'in-blank', alcoholUnitsWeek: '   ', rawData: '{}' },
      { legacyIntakeId: 'in-plain', alcoholUnitsWeek: '10', rawData: '{}' },
      { legacyIntakeId: 'in-ml', alcoholUnitsWeek: '100 ml', rawData: '{}' },
      { legacyIntakeId: 'in-words', alcoholUnitsWeek: 'occasionally', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports the same empty cells as v1, proposing nothing', async () => {
    const response = await i34V2.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    for (const [id, prev] of [
      ['in-null', null],
      ['in-empty', ''],
      ['in-blank', '   '],
    ] as const) {
      expect(byId.get(id)).toEqual({ table: 'intake', legacyId: id, column: 'alcohol_units_week', prev, next: null });
    }
    expect(response.updates).toHaveLength(3);
    expect(response.ambiguity).toBe(true);

    const v1 = await i34.run(context);
    expect(response.updates).toEqual(v1.updates);
  });

  it('asks for the figure in millilitres, and is registered after v1', () => {
    expect(i34V2.ruleId).toBe('I34');
    expect(i34V2.version).toBe(2);
    expect(i34V2.ambiguous).toBe(true);
    expect(i34V2.description).toContain('millilitres');

    expect(ruleCatalogue).toContain(i34);
    expect(ruleCatalogue.indexOf(i34V2)).toBeGreaterThan(ruleCatalogue.indexOf(i34));
  });
});
