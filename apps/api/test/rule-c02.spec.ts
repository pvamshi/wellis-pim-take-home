import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { c02 } from '../src/rules/catalogue/c02';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('C02 — a consent referencing a patient that does not exist', () => {
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
    const consents: Repository<LegacyConsent> = dataSource.getRepository(LegacyConsent);
    const patients: Repository<LegacyPatient> = dataSource.getRepository(LegacyPatient);
    context = createRuleContext(dataSource.manager);

    await patients.save([{ legacyPatientId: 'rec-real', rawData: '{}' }]);
    await consents.save([
      { legacyPatientId: 'rec-missing', action: 'granted', rawData: '{}' },
      { legacyPatientId: 'rec-real', action: 'granted', rawData: '{}' },
      // Padded but would match once trimmed — C01's fix, not this rule's.
      { legacyPatientId: ' rec-real', action: 'granted', rawData: '{}' },
      // No reference to check at all — C03's finding.
      { legacyPatientId: '   ', action: 'granted', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a consent whose patient id matches no patient row, proposing nothing', async () => {
    const response = await c02.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('rec-missing')).toEqual({
      table: 'consent',
      legacyId: 'rec-missing',
      column: 'patient_legacy_id',
      prev: 'rec-missing',
      next: null,
    });

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('rec-real');
    expect(touched).not.toContain(' rec-real');
    expect(touched).not.toContain('   ');

    expect(response.ambiguity).toBe(true);
    expect(c02.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(c02);
  });
});
