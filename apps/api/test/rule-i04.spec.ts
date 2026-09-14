import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { i04 } from '../src/rules/catalogue/i04';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I04 — an intake referencing a patient that does not exist', () => {
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
    const patients: Repository<LegacyPatient> = dataSource.getRepository(LegacyPatient);
    context = createRuleContext(dataSource.manager);

    await patients.save([{ legacyPatientId: 'rec-real', rawData: '{}' }]);
    await intakes.save([
      { legacyIntakeId: 'in-orphan', legacyPatientId: 'rec-missing', rawData: '{}' },
      { legacyIntakeId: 'in-matched', legacyPatientId: 'rec-real', rawData: '{}' },
      // Padded but would match once trimmed — I03's fix, not this rule's.
      { legacyIntakeId: 'in-padded', legacyPatientId: ' rec-real', rawData: '{}' },
      // No reference to check at all — I05's finding.
      { legacyIntakeId: 'in-blank', legacyPatientId: '   ', rawData: '{}' },
      { legacyIntakeId: 'in-null', legacyPatientId: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports an intake whose patient id matches no patient row, proposing nothing', async () => {
    const response = await i04.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-orphan')).toEqual({
      table: 'intake',
      legacyId: 'in-orphan',
      column: 'legacy_patient_id',
      prev: 'rec-missing',
      next: null,
    });

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('in-matched');
    expect(touched).not.toContain('in-padded');
    expect(touched).not.toContain('in-blank');
    expect(touched).not.toContain('in-null');

    expect(response.ambiguity).toBe(true);
    expect(i04.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i04);
  });
});
