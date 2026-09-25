import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p67 } from '../src/rules/catalogue/p67';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P67 — a blank-unit weight that reads as pounds, converted to kilograms', () => {
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
    const patients: Repository<LegacyPatient> = dataSource.getRepository(LegacyPatient);
    context = createRuleContext(dataSource.manager);

    await patients.save([
      // The lightest and heaviest blank-unit rows in the export.
      { legacyPatientId: 'p-light', weight: '140.2', weightUnit: '', heightCm: '153', rawData: '{}' },
      { legacyPatientId: 'p-heavy', weight: '320.1', weightUnit: null, heightCm: '186', rawData: '{}' },
      { legacyPatientId: 'p-padded', weight: ' 200 ', weightUnit: '  ', heightCm: '175', rawData: '{}' },
      // 82 at 180 cm reads as kg — P47's.
      { legacyPatientId: 'p-kg', weight: '82', weightUnit: null, heightCm: '180', rawData: '{}' },
      // 120 at 170 cm: both readings believable, unsettled.
      { legacyPatientId: 'p-both', weight: '120', weightUnit: null, heightCm: '170', rawData: '{}' },
      { legacyPatientId: 'p-no-height', weight: '200', weightUnit: null, heightCm: null, rawData: '{}' },
      { legacyPatientId: 'p-dirty-weight', weight: '200 lbs', weightUnit: null, heightCm: '175', rawData: '{}' },
      { legacyPatientId: 'p-lbs-written', weight: '200', weightUnit: 'lbs', heightCm: '175', rawData: '{}' }, // P66's
      { legacyPatientId: 'p-kg-written', weight: '200', weightUnit: 'kg', heightCm: '175', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the weight in kilograms and kg as the unit, together', async () => {
    const response = await p67.run(context);

    expect(response.updates).toEqual([
      { table: 'patient', legacyId: 'p-light', column: 'weight', prev: '140.2', next: '63.6' },
      { table: 'patient', legacyId: 'p-light', column: 'weight_unit', prev: '', next: 'kg' },
      { table: 'patient', legacyId: 'p-heavy', column: 'weight', prev: '320.1', next: '145.2' },
      { table: 'patient', legacyId: 'p-heavy', column: 'weight_unit', prev: null, next: 'kg' },
      { table: 'patient', legacyId: 'p-padded', column: 'weight', prev: ' 200 ', next: '90.7' },
      { table: 'patient', legacyId: 'p-padded', column: 'weight_unit', prev: '  ', next: 'kg' },
    ]);
    expect(response.ambiguity).toBe(false);
  });

  it('is a new rule at version 1, not ambiguous, in the catalogue', () => {
    expect(p67.ruleId).toBe('P67');
    expect(p67.version).toBe(1);
    expect(p67.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(p67);
  });
});
