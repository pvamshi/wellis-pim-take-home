import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i25 } from '../src/rules/catalogue/i25';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I25 — an intake current-medication value that is a way of saying nothing', () => {
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
      { legacyIntakeId: 'in-geen', medsCurrent: 'Geen', rawData: '{}' },
      { legacyIntakeId: 'in-na', medsCurrent: 'N/A', rawData: '{}' },
      { legacyIntakeId: 'in-nvt', medsCurrent: 'nvt', rawData: '{}' },
      { legacyIntakeId: 'in-x', medsCurrent: 'X', rawData: '{}' },
      { legacyIntakeId: 'in-padded', medsCurrent: '  NONE  ', rawData: '{}' }, // padded and loosely spelt
      { legacyIntakeId: 'in-canonical', medsCurrent: 'none', rawData: '{}' }, // already canonical
      { legacyIntakeId: 'in-real', medsCurrent: 'Metformin 500mg', rawData: '{}' }, // real content
      { legacyIntakeId: 'in-null', medsCurrent: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the canonical empty marker for every recognised way of saying nothing', async () => {
    const response = await i25.run(context);
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
        column: 'meds_current',
        prev,
        next: 'none',
      });
    }

    expect(byId.has('in-canonical')).toBe(false);
    expect(byId.has('in-real')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(i25.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i25);
  });
});
