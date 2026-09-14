import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i27 } from '../src/rules/catalogue/i27';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I27 — an intake conditions value with whitespace around it', () => {
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
      { legacyIntakeId: 'in-padded', conditions: '  Diabetes type 2  ', rawData: '{}' },
      { legacyIntakeId: 'in-clean', conditions: 'Diabetes type 2', rawData: '{}' },
      { legacyIntakeId: 'in-blank', conditions: '   ', rawData: '{}' }, // nothing left to propose
      { legacyIntakeId: 'in-marker', conditions: '  geen  ', rawData: '{}' }, // I28's finding
      { legacyIntakeId: 'in-null', conditions: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the trimmed text for a padded conditions cell', async () => {
    const response = await i27.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-padded')).toEqual({
      table: 'intake',
      legacyId: 'in-padded',
      column: 'conditions',
      prev: '  Diabetes type 2  ',
      next: 'Diabetes type 2',
    });

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('in-clean');
    expect(touched).not.toContain('in-blank');
    expect(touched).not.toContain('in-marker');
    expect(touched).not.toContain('in-null');

    expect(response.ambiguity).toBe(false);
    expect(i27.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i27);
  });
});
