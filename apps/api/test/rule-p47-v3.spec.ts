import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p47V2 } from '../src/rules/catalogue/p47-v2';
import { p47V3 } from '../src/rules/catalogue/p47-v3';
import { p67 } from '../src/rules/catalogue/p67';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P47 v3 — a blank weight unit proposed as kg only where the weight reads as kilograms', () => {
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
      // 82 kg at 180 cm: BMI 25.3 as kg, 11.5 as lb.
      { legacyPatientId: 'p-kg-null', weight: '82', weightUnit: null, heightCm: '180', rawData: '{}' },
      { legacyPatientId: 'p-kg-blank', weight: '82', weightUnit: '   ', heightCm: '180', rawData: '{}' },
      // 180.1 at 174 cm (from the export): BMI 59.5 as kg, 27.0 as lb — P67's.
      { legacyPatientId: 'p-lb', weight: '180.1', weightUnit: '', heightCm: '174', rawData: '{}' },
      // 120 at 170 cm: BMI 41.5 as kg, 18.8 as lb — both believable, unsettled.
      { legacyPatientId: 'p-both', weight: '120', weightUnit: null, heightCm: '170', rawData: '{}' },
      { legacyPatientId: 'p-no-height', weight: '82', weightUnit: null, heightCm: null, rawData: '{}' },
      { legacyPatientId: 'p-dirty-height', weight: '82', weightUnit: null, heightCm: '1,80', rawData: '{}' },
      { legacyPatientId: 'p-dirty-weight', weight: '82 kg', weightUnit: null, heightCm: '180', rawData: '{}' },
      { legacyPatientId: 'p-has-unit', weight: '82', weightUnit: 'lbs', heightCm: '180', rawData: '{}' },
      { legacyPatientId: 'p-neither', weight: null, weightUnit: null, heightCm: '180', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes kg where only the kilogram reading gives a believable BMI', async () => {
    const response = await p47V3.run(context);

    expect(response.updates).toEqual([
      { table: 'patient', legacyId: 'p-kg-null', column: 'weight_unit', prev: null, next: 'kg' },
      { table: 'patient', legacyId: 'p-kg-blank', column: 'weight_unit', prev: '   ', next: 'kg' },
    ]);
    expect(response.ambiguity).toBe(false);
  });

  it('no longer proposes kg for a weight that reads as pounds, which v2 did', async () => {
    const v2 = await p47V2.run(context);
    const v3 = await p47V3.run(context);

    expect(v2.updates.map((update) => update.legacyId)).toContain('p-lb');
    expect(v3.updates.map((update) => update.legacyId)).not.toContain('p-lb');
  });

  it('never catches a row P67 catches', async () => {
    const kilograms = new Set((await p47V3.run(context)).updates.map((update) => update.legacyId));
    const pounds = (await p67.run(context)).updates.map((update) => update.legacyId);

    for (const id of pounds) expect(kilograms.has(id)).toBe(false);
  });

  it('is registered after v2, and stays not ambiguous', () => {
    expect(p47V3.ruleId).toBe('P47');
    expect(p47V3.version).toBe(3);
    expect(p47V3.ambiguous).toBe(false);
    expect(ruleCatalogue.indexOf(p47V3)).toBeGreaterThan(ruleCatalogue.indexOf(p47V2));
  });
});
