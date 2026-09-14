import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i01 } from '../src/rules/catalogue/i01';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I01 — an intake id with whitespace around it', () => {
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
      { legacyIntakeId: ' in-lead', rawData: '{}' },
      { legacyIntakeId: 'in-trail ', rawData: '{}' },
      { legacyIntakeId: 'in-clean', rawData: '{}' },
      { legacyIntakeId: 'in inner', rawData: '{}' },
      { legacyIntakeId: '   ', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the trimmed id for a padded intake id and leaves the rest alone', async () => {
    const response = await i01.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get(' in-lead')).toEqual({
      table: 'intake',
      legacyId: ' in-lead',
      column: 'intake_id',
      prev: ' in-lead',
      next: 'in-lead',
    });
    expect(byId.get('in-trail ')?.next).toBe('in-trail');

    // Already clean, an inner space, and whitespace-only (nothing to trim to).
    expect(byId.has('in-clean')).toBe(false);
    expect(byId.has('in inner')).toBe(false);
    expect(byId.has('   ')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(i01.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i01);
  });
});
