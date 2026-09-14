import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i38 } from '../src/rules/catalogue/i38';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I38 — an intake reviewer note with whitespace around it', () => {
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
      { legacyIntakeId: 'in-lead', reviewerNote: ' looks fine', rawData: '{}' },
      { legacyIntakeId: 'in-trail', reviewerNote: 'needs review ', rawData: '{}' },
      { legacyIntakeId: 'in-clean', reviewerNote: 'no padding here', rawData: '{}' },
      { legacyIntakeId: 'in-null', reviewerNote: null, rawData: '{}' },
      // Whitespace-only: unlike an id column, an empty note is still a valid
      // note — there is no companion rule to hand this to.
      { legacyIntakeId: 'in-blank', reviewerNote: '   ', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the trimmed note text and leaves the rest alone', async () => {
    const response = await i38.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-lead')).toEqual({
      table: 'intake',
      legacyId: 'in-lead',
      column: 'reviewer_note',
      prev: ' looks fine',
      next: 'looks fine',
    });
    expect(byId.get('in-trail')?.next).toBe('needs review');
    expect(byId.get('in-blank')).toEqual({
      table: 'intake',
      legacyId: 'in-blank',
      column: 'reviewer_note',
      prev: '   ',
      next: '',
    });

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('in-clean');
    expect(touched).not.toContain('in-null');

    expect(response.ambiguity).toBe(false);
    expect(i38.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i38);
  });
});
