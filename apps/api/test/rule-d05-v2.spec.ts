import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { d05V2 } from '../src/rules/catalogue/d05-v2';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('D05 v2 — two intakes sharing the same intake id, both rows named', () => {
  let app: INestApplication;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let context: RuleContext;
  let firstId: string;
  let secondId: string;

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

    const saved = await intakes.save([
      { legacyIntakeId: 'in-first', rawData: '{}' },
      { legacyIntakeId: 'in-first', rawData: '{}' },
      { legacyIntakeId: 'in-unrelated', rawData: '{}' },
      // Different intake id text — I01's finding, not a match for this one.
      { legacyIntakeId: 'IN-FIRST', rawData: '{}' },
      { legacyIntakeId: '   ', rawData: '{}' },
    ]);
    firstId = saved[0].id;
    secondId = saved[1].id;
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('links a later row to the first row with the same intake id, naming both rows as distinct rows', async () => {
    const response = await d05V2.run(context);

    expect(response.duplicates).toEqual([
      {
        table: 'intake',
        duplicateLegacyId: 'in-first',
        duplicateRowId: secondId,
        canonicalLegacyId: 'in-first',
        canonicalRowId: firstId,
      },
    ]);
    expect(response.updates).toEqual([]);
    expect(response.ambiguity).toBe(false);
    expect(d05V2.ambiguous).toBe(false);
    expect(d05V2.version).toBe(2);
    expect(ruleCatalogue).toContain(d05V2);

    // The bug 1.7.1 names for D05: X and Y share one legacy id but are two
    // distinct physical rows.
    const [link] = response.duplicates!;
    expect(link.duplicateRowId).not.toBe(link.canonicalRowId);
  });
});
