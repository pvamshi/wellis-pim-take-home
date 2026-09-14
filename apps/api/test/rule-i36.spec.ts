import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i36 } from '../src/rules/catalogue/i36';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I36 — an intake outcome nobody recognises', () => {
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
      { legacyIntakeId: 'in-ok', outcome: 'OK', rawData: '{}' },
      { legacyIntakeId: 'in-declined', outcome: 'declined', rawData: '{}' },
      { legacyIntakeId: 'in-review', outcome: 'in review', rawData: '{}' },
      { legacyIntakeId: 'in-recognised', outcome: 'Approved', rawData: '{}' }, // I35's territory
      { legacyIntakeId: 'in-empty', outcome: '', rawData: '{}' }, // I37's territory
      { legacyIntakeId: 'in-null', outcome: null, rawData: '{}' }, // I37's territory
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports an unrecognised outcome with no proposed value, and leaves the rest alone', async () => {
    const response = await i36.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    for (const [id, prev] of [
      ['in-ok', 'OK'],
      ['in-declined', 'declined'],
      ['in-review', 'in review'],
    ] as const) {
      expect(byId.get(id)).toEqual({ table: 'intake', legacyId: id, column: 'outcome', prev, next: null });
    }

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('in-recognised');
    expect(touched).not.toContain('in-empty');
    expect(touched).not.toContain('in-null');

    expect(response.ambiguity).toBe(true);
    expect(i36.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i36);
  });
});
