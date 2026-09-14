import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i37 } from '../src/rules/catalogue/i37';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I37 — an intake outcome that is empty', () => {
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
      { legacyIntakeId: 'in-null', outcome: null, rawData: '{}' },
      { legacyIntakeId: 'in-empty', outcome: '', rawData: '{}' },
      { legacyIntakeId: 'in-blank', outcome: '   ', rawData: '{}' },
      { legacyIntakeId: 'in-recognised', outcome: 'Approved', rawData: '{}' },
      { legacyIntakeId: 'in-unrecognised', outcome: 'OK', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a missing outcome, proposing nothing', async () => {
    const response = await i37.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    for (const [id, prev] of [
      ['in-null', null],
      ['in-empty', ''],
      ['in-blank', '   '],
    ] as const) {
      expect(byId.get(id)).toEqual({ table: 'intake', legacyId: id, column: 'outcome', prev, next: null });
    }

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('in-recognised');
    expect(touched).not.toContain('in-unrecognised');

    expect(response.ambiguity).toBe(true);
    expect(i37.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i37);
  });
});
