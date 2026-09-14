import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i35 } from '../src/rules/catalogue/i35';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I35 — an intake outcome written in a recognised, non-canonical spelling', () => {
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
      { legacyIntakeId: 'in-case', outcome: 'Approved', rawData: '{}' },
      { legacyIntakeId: 'in-dutch', outcome: 'afgewezen', rawData: '{}' },
      { legacyIntakeId: 'in-padded', outcome: 'approved ', rawData: '{}' }, // trailing space — proves the trim
      { legacyIntakeId: 'in-canonical', outcome: 'pending', rawData: '{}' }, // already canonical
      { legacyIntakeId: 'in-unrecognised', outcome: 'OK', rawData: '{}' }, // I36's territory
      { legacyIntakeId: 'in-null', outcome: null, rawData: '{}' }, // I37's territory
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a recognised outcome spelling and proposes the canonical value', async () => {
    const response = await i35.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    // in-padded is a same-case value with only whitespace differing from canonical — it
    // proves the lookup trims, not just lower-cases.
    for (const [id, prev, next] of [
      ['in-case', 'Approved', 'approved'],
      ['in-dutch', 'afgewezen', 'rejected'],
      ['in-padded', 'approved ', 'approved'],
    ] as const) {
      expect(byId.get(id)).toEqual({ table: 'intake', legacyId: id, column: 'outcome', prev, next });
    }

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('in-canonical');
    expect(touched).not.toContain('in-unrecognised');
    expect(touched).not.toContain('in-null');

    expect(response.ambiguity).toBe(false);
    expect(i35.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i35);
  });
});
