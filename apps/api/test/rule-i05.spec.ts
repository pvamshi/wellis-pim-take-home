import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i05 } from '../src/rules/catalogue/i05';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I05 — an intake row with no patient reference', () => {
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
      { legacyIntakeId: 'in-null', legacyPatientId: null, rawData: '{}' },
      { legacyIntakeId: 'in-blank', legacyPatientId: '  \t', rawData: '{}' },
      { legacyIntakeId: 'in-present', legacyPatientId: 'rec123', rawData: '{}' },
      // Real content that doesn't match a patient is I04's finding, not this
      // rule's — this rule sees no id at all to judge.
      { legacyIntakeId: 'in-orphan', legacyPatientId: 'rec-missing', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a missing or whitespace-only patient reference, proposing nothing', async () => {
    const response = await i05.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-null')).toEqual({
      table: 'intake',
      legacyId: 'in-null',
      column: 'legacy_patient_id',
      prev: null,
      next: null,
    });
    expect(byId.get('in-blank')?.prev).toBe('  \t');

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('in-present');
    expect(touched).not.toContain('in-orphan');

    expect(response.ambiguity).toBe(true);
    expect(i05.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i05);
  });
});
