import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i15 } from '../src/rules/catalogue/i15';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I15 — an intake weight written with a comma decimal', () => {
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
      { legacyIntakeId: 'in-half', weight: '82,5', rawData: '{}' },
      // Only the comma moves: the padding around it is not this rule's fix.
      { legacyIntakeId: 'in-padded', weight: ' 82,5 ', rawData: '{}' },
      // The unit typed into the value reaches I16 exactly as it was written.
      { legacyIntakeId: 'in-unit', weight: '82,5 kg', rawData: '{}' },
      // Already written the way the column is written.
      { legacyIntakeId: 'in-dot', weight: '82.5', rawData: '{}' },
      // Three digits after the comma is a thousands group as much as a
      // fraction — one reading only, and this is not it.
      { legacyIntakeId: 'in-grouped', weight: '1,234', rawData: '{}' },
      { legacyIntakeId: 'in-null', weight: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the dot form of a comma decimal, and leaves the rest alone', async () => {
    const response = await i15.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-half')).toEqual({
      table: 'intake',
      legacyId: 'in-half',
      column: 'weight',
      prev: '82,5',
      next: '82.5',
    });
    expect(byId.get('in-padded')).toEqual({
      table: 'intake',
      legacyId: 'in-padded',
      column: 'weight',
      prev: ' 82,5 ',
      next: ' 82.5 ',
    });
    expect(byId.get('in-unit')).toEqual({
      table: 'intake',
      legacyId: 'in-unit',
      column: 'weight',
      prev: '82,5 kg',
      next: '82.5 kg',
    });

    expect(byId.has('in-dot')).toBe(false);
    expect(byId.has('in-grouped')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(i15.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i15);
  });
});
