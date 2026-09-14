import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i29 } from '../src/rules/catalogue/i29';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I29 — an intake conditions value mixing Dutch and English free text', () => {
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
      { legacyIntakeId: 'in-dutch', conditions: 'hoge bloeddruk', rawData: '{}' },
      { legacyIntakeId: 'in-mixed', conditions: 'diabetes en astma', rawData: '{}' },
      { legacyIntakeId: 'in-padded', conditions: '  hoge bloeddruk  ', rawData: '{}' }, // I27's finding
      { legacyIntakeId: 'in-marker', conditions: 'nvt', rawData: '{}' }, // I28's finding
      { legacyIntakeId: 'in-blank', conditions: '   ', rawData: '{}' },
      { legacyIntakeId: 'in-null', conditions: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports mixed-language conditions free text, proposing nothing', async () => {
    const response = await i29.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-dutch')).toEqual({
      table: 'intake',
      legacyId: 'in-dutch',
      column: 'conditions',
      prev: 'hoge bloeddruk',
      next: null,
    });
    expect(byId.get('in-mixed')).toEqual({
      table: 'intake',
      legacyId: 'in-mixed',
      column: 'conditions',
      prev: 'diabetes en astma',
      next: null,
    });

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('in-padded');
    expect(touched).not.toContain('in-marker');
    expect(touched).not.toContain('in-blank');
    expect(touched).not.toContain('in-null');

    expect(response.ambiguity).toBe(true);
    expect(i29.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i29);
  });
});
