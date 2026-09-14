import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i32 } from '../src/rules/catalogue/i32';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I32 — an intake weekly alcohol units value written in words', () => {
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
      { legacyIntakeId: 'in-occasionally', alcoholUnitsWeek: 'occasionally', rawData: '{}' },
      { legacyIntakeId: 'in-soms', alcoholUnitsWeek: 'soms', rawData: '{}' },
      { legacyIntakeId: 'in-nvt', alcoholUnitsWeek: 'n.v.t.', rawData: '{}' }, // not a listed word, still caught
      { legacyIntakeId: 'in-plain', alcoholUnitsWeek: '10', rawData: '{}' }, // I30's/I33's territory
      { legacyIntakeId: 'in-negative', alcoholUnitsWeek: '-2', rawData: '{}' }, // a number, not words
      { legacyIntakeId: 'in-range', alcoholUnitsWeek: '5-10', rawData: '{}' }, // I31's territory
      { legacyIntakeId: 'in-blank', alcoholUnitsWeek: '   ', rawData: '{}' }, // I34's territory
      { legacyIntakeId: 'in-null', alcoholUnitsWeek: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a weekly alcohol units value written in words, proposing nothing', async () => {
    const response = await i32.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    // in-nvt is not one of the catalogue's named words — it proves the rule catches
    // anything that fails to parse as a range or number, not a hardcoded word list.
    for (const [id, prev] of [
      ['in-occasionally', 'occasionally'],
      ['in-soms', 'soms'],
      ['in-nvt', 'n.v.t.'],
    ] as const) {
      expect(byId.get(id)).toEqual({ table: 'intake', legacyId: id, column: 'alcohol_units_week', prev, next: null });
    }

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('in-plain');
    expect(touched).not.toContain('in-negative');
    expect(touched).not.toContain('in-range');
    expect(touched).not.toContain('in-blank');
    expect(touched).not.toContain('in-null');

    expect(response.ambiguity).toBe(true);
    expect(i32.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i32);
  });
});
