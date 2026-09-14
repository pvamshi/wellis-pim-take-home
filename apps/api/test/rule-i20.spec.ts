import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i20 } from '../src/rules/catalogue/i20';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I20 — an intake height written with a comma decimal', () => {
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
      { legacyIntakeId: 'in-comma', height: '175,5', rawData: '{}' },
      // Already a dot — nothing for this rule to fix.
      { legacyIntakeId: 'in-dot', height: '175.5', rawData: '{}' },
      // A second comma, or a comma alongside a dot — not this rule's single reading.
      { legacyIntakeId: 'in-double-comma', height: '1,75,5', rawData: '{}' },
      { legacyIntakeId: 'in-comma-and-dot', height: '175.5,5', rawData: '{}' },
      { legacyIntakeId: 'in-null', height: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the dot form of a comma-decimal height, and leaves the rest alone', async () => {
    const response = await i20.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-comma')).toEqual({
      table: 'intake',
      legacyId: 'in-comma',
      column: 'height',
      prev: '175,5',
      next: '175.5',
    });

    expect(byId.has('in-dot')).toBe(false);
    expect(byId.has('in-double-comma')).toBe(false);
    expect(byId.has('in-comma-and-dot')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(i20.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i20);
  });
});
