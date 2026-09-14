import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i28 } from '../src/rules/catalogue/i28';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I28 — an intake conditions value that is a way of saying nothing', () => {
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
      { legacyIntakeId: 'in-geen', conditions: 'Geen', rawData: '{}' },
      { legacyIntakeId: 'in-na', conditions: 'N/A', rawData: '{}' },
      { legacyIntakeId: 'in-nvt', conditions: 'nvt', rawData: '{}' },
      { legacyIntakeId: 'in-x', conditions: 'X', rawData: '{}' },
      { legacyIntakeId: 'in-padded', conditions: '  NONE  ', rawData: '{}' }, // padded and loosely spelt
      { legacyIntakeId: 'in-canonical', conditions: 'none', rawData: '{}' }, // already canonical
      { legacyIntakeId: 'in-real', conditions: 'Diabetes type 2', rawData: '{}' }, // real content
      { legacyIntakeId: 'in-null', conditions: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the canonical empty marker for every recognised way of saying nothing', async () => {
    const response = await i28.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    for (const [id, prev] of [
      ['in-geen', 'Geen'],
      ['in-na', 'N/A'],
      ['in-nvt', 'nvt'],
      ['in-x', 'X'],
      ['in-padded', '  NONE  '],
    ] as const) {
      expect(byId.get(id)).toEqual({
        table: 'intake',
        legacyId: id,
        column: 'conditions',
        prev,
        next: 'none',
      });
    }

    expect(byId.has('in-canonical')).toBe(false);
    expect(byId.has('in-real')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(i28.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i28);
  });
});
