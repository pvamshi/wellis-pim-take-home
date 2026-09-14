import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i24 } from '../src/rules/catalogue/i24';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I24 — an intake current-medication value with whitespace around it', () => {
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
      { legacyIntakeId: 'in-padded', medsCurrent: '  Metformin 500mg  ', rawData: '{}' },
      // Already clean — nothing to fix.
      { legacyIntakeId: 'in-clean', medsCurrent: 'Metformin 500mg', rawData: '{}' },
      // Trims to nothing — nothing left to propose.
      { legacyIntakeId: 'in-blank', medsCurrent: '   ', rawData: '{}' },
      // A padded empty-marker — I25's finding, which folds the padding in too.
      { legacyIntakeId: 'in-padded-marker', medsCurrent: '  none  ', rawData: '{}' },
      { legacyIntakeId: 'in-null', medsCurrent: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the trimmed text of a padded medication cell, and leaves the rest alone', async () => {
    const response = await i24.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-padded')).toEqual({
      table: 'intake',
      legacyId: 'in-padded',
      column: 'meds_current',
      prev: '  Metformin 500mg  ',
      next: 'Metformin 500mg',
    });

    expect(byId.has('in-clean')).toBe(false);
    expect(byId.has('in-blank')).toBe(false);
    expect(byId.has('in-padded-marker')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(i24.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i24);
  });
});
