import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i12 } from '../src/rules/catalogue/i12';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I12 — a recognised intake questionnaire version, made canonical', () => {
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
      { legacyIntakeId: 'in-upper', questionnaireVersion: 'V2', rawData: '{}' },
      { legacyIntakeId: 'in-bare-number', questionnaireVersion: '2', rawData: '{}' },
      { legacyIntakeId: 'in-word', questionnaireVersion: 'version 2', rawData: '{}' },
      { legacyIntakeId: 'in-decimal', questionnaireVersion: 'v2.0', rawData: '{}' },
      { legacyIntakeId: 'in-canonical', questionnaireVersion: 'v1', rawData: '{}' },
      { legacyIntakeId: 'in-unknown-version', questionnaireVersion: 'v4', rawData: '{}' },
      { legacyIntakeId: 'in-garbage', questionnaireVersion: 'beta', rawData: '{}' },
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

  it('proposes the canonical version for a loose spelling, and leaves the rest alone', async () => {
    const response = await i12.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-upper')).toEqual({
      table: 'intake',
      legacyId: 'in-upper',
      column: 'questionnaire_version',
      prev: 'V2',
      next: 'v2',
    });
    expect(byId.get('in-bare-number')).toEqual({
      table: 'intake',
      legacyId: 'in-bare-number',
      column: 'questionnaire_version',
      prev: '2',
      next: 'v2',
    });
    expect(byId.get('in-word')).toEqual({
      table: 'intake',
      legacyId: 'in-word',
      column: 'questionnaire_version',
      prev: 'version 2',
      next: 'v2',
    });
    expect(byId.get('in-decimal')).toEqual({
      table: 'intake',
      legacyId: 'in-decimal',
      column: 'questionnaire_version',
      prev: 'v2.0',
      next: 'v2',
    });

    // Already canonical, a version-shaped label naming none that exist
    // (I13's), free text nobody recognises (I13's), and empty or absent
    // (I14's) are all walked past.
    expect(byId.has('in-canonical')).toBe(false);
    expect(byId.has('in-unknown-version')).toBe(false);
    expect(byId.has('in-garbage')).toBe(false);
    expect(byId.has('in-empty')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(i12.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i12);
  });
});
