import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i13 } from '../src/rules/catalogue/i13';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I13 — an intake questionnaire version nobody recognises', () => {
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
      { legacyIntakeId: 'in-unknown-version', questionnaireVersion: 'v4', rawData: '{}' },
      { legacyIntakeId: 'in-garbage', questionnaireVersion: 'beta', rawData: '{}' },
      { legacyIntakeId: 'in-year', questionnaireVersion: '2024-intake', rawData: '{}' },
      { legacyIntakeId: 'in-recognised', questionnaireVersion: 'V2', rawData: '{}' },
      { legacyIntakeId: 'in-canonical', questionnaireVersion: 'v1', rawData: '{}' },
      { legacyIntakeId: 'in-empty', questionnaireVersion: '', rawData: '{}' },
      { legacyIntakeId: 'in-null', questionnaireVersion: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a version matching no known version with no proposed value, and leaves the rest alone', async () => {
    const response = await i13.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-unknown-version')).toEqual({
      table: 'intake',
      legacyId: 'in-unknown-version',
      column: 'questionnaire_version',
      prev: 'v4',
      next: null,
    });
    expect(byId.get('in-garbage')).toEqual({
      table: 'intake',
      legacyId: 'in-garbage',
      column: 'questionnaire_version',
      prev: 'beta',
      next: null,
    });
    expect(byId.get('in-year')).toEqual({
      table: 'intake',
      legacyId: 'in-year',
      column: 'questionnaire_version',
      prev: '2024-intake',
      next: null,
    });

    // A loose spelling I12 already reads, an already-canonical value, and an
    // empty or absent cell (I14's) are not this rule's.
    expect(byId.has('in-recognised')).toBe(false);
    expect(byId.has('in-canonical')).toBe(false);
    expect(byId.has('in-empty')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(i13.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i13);
  });
});
