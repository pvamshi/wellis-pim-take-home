import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i02 } from '../src/rules/catalogue/i02';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I02 — an intake row with no id', () => {
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
      { legacyIntakeId: '', rawData: '{}' },
      { legacyIntakeId: '   ', rawData: '{}' },
      { legacyIntakeId: 'in-clean', rawData: '{}' },
      // Padded but addressable is I01's fix, not this rule's finding.
      { legacyIntakeId: ' in-lead', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports every row whose intake id is empty or only whitespace, proposing nothing', async () => {
    const response = await i02.run(context);
    const byId = new Map(response.updates.map((update) => [JSON.stringify(update.prev), update]));

    expect(byId.get(JSON.stringify(''))).toEqual({
      table: 'intake',
      legacyId: '',
      column: 'intake_id',
      prev: '',
      next: null,
    });
    expect(byId.get(JSON.stringify('   '))).toEqual({
      table: 'intake',
      legacyId: '   ',
      column: 'intake_id',
      prev: '   ',
      next: null,
    });

    const touched = response.updates.map((update) => update.prev);
    expect(touched).not.toContain('in-clean');
    expect(touched).not.toContain(' in-lead');

    expect(response.ambiguity).toBe(true);
    expect(i02.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i02);
  });
});
