import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i14 } from '../src/rules/catalogue/i14';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I14 — an intake questionnaire version that is empty', () => {
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
      { legacyIntakeId: 'in-null', questionnaireVersion: null, rawData: '{}' },
      { legacyIntakeId: 'in-empty', questionnaireVersion: '', rawData: '{}' },
      { legacyIntakeId: 'in-whitespace', questionnaireVersion: '  \t', rawData: '{}' },
      { legacyIntakeId: 'in-present', questionnaireVersion: 'v2', rawData: '{}' },
      // Malformed but not empty: I12 or I13's business, not this rule's.
      { legacyIntakeId: 'in-unknown-version', questionnaireVersion: 'v4', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a missing or whitespace-only questionnaire version, proposing nothing', async () => {
    const response = await i14.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-null')).toEqual({
      table: 'intake',
      legacyId: 'in-null',
      column: 'questionnaire_version',
      prev: null,
      next: null,
    });
    expect(byId.get('in-empty')?.prev).toBe('');
    expect(byId.get('in-whitespace')?.prev).toBe('  \t');

    expect(byId.has('in-present')).toBe(false);
    expect(byId.has('in-unknown-version')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(i14.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i14);
  });
});
