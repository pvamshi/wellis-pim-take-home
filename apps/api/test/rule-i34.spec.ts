import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i34 } from '../src/rules/catalogue/i34';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I34 — an intake weekly alcohol units value that is empty', () => {
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
      { legacyIntakeId: 'in-words', alcoholUnitsWeek: 'occasionally', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a missing weekly alcohol units value, proposing nothing', async () => {
    const response = await i34.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    for (const [id, prev] of [
      ['in-null', null],
      ['in-empty', ''],
      ['in-blank', '   '],
    ] as const) {
      expect(byId.get(id)).toEqual({ table: 'intake', legacyId: id, column: 'alcohol_units_week', prev, next: null });
    }

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('in-plain');
    expect(touched).not.toContain('in-words');

    expect(response.ambiguity).toBe(true);
    expect(i34.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i34);
  });
});
