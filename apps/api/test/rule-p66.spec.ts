import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p66 } from '../src/rules/catalogue/p66';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P66 — a patient weight recorded in pounds, converted to kilograms', () => {
  let app: INestApplication;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let patients: Repository<LegacyPatient>;
  let context: RuleContext;

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const dataSource = app.get(DataSource);
    patients = dataSource.getRepository(LegacyPatient);
    context = createRuleContext(dataSource.manager);

    await patients.save([
      { legacyPatientId: 'w-pounds', weight: '180', weightUnit: 'lbs', rawData: '{}' },
      { legacyPatientId: 'w-decimal', weight: ' 150.5 ', weightUnit: 'lbs', rawData: '{}' },
      { legacyPatientId: 'w-kilograms', weight: '82', weightUnit: 'kg', rawData: '{}' },
      { legacyPatientId: 'w-spelled', weight: '180', weightUnit: 'pounds', rawData: '{}' },
      { legacyPatientId: 'w-unit-in-value', weight: '180 lbs', weightUnit: 'lbs', rawData: '{}' },
      { legacyPatientId: 'w-implausible', weight: '900', weightUnit: 'lbs', rawData: '{}' },
      { legacyPatientId: 'w-no-unit', weight: '180', weightUnit: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the weight in kilograms and kg as the unit, as one fix on two columns', async () => {
    const response = await p66.run(context);
    const of = (legacyId: string) =>
      response.updates.filter((update) => update.legacyId === legacyId);

    expect(of('w-pounds')).toEqual([
      { table: 'patient', legacyId: 'w-pounds', column: 'weight', prev: '180', next: '81.6' },
      { table: 'patient', legacyId: 'w-pounds', column: 'weight_unit', prev: 'lbs', next: 'kg' },
    ]);

    // 150.5 lb is 68.27 kg, rounded to one decimal, read through the padding.
    expect(of('w-decimal').map((update) => update.next)).toEqual(['68.3', 'kg']);

    // Already kilograms; another spelling of pounds (P46); the unit written in
    // the value (P42); implausible in either unit (P44); no unit at all (P47).
    for (const legacyId of [
      'w-kilograms',
      'w-spelled',
      'w-unit-in-value',
      'w-implausible',
      'w-no-unit',
    ]) {
      expect(of(legacyId)).toEqual([]);
    }

    expect(response.ambiguity).toBe(false);
  });

  it('is registered in the catalogue as a rule that proposes values', () => {
    expect(ruleCatalogue).toContain(p66);
    expect(p66.ambiguous).toBe(false);
  });
});
