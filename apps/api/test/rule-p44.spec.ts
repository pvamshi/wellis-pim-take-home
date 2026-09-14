import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p44 } from '../src/rules/catalogue/p44';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P44 — a patient weight implausible in either unit', () => {
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
      { legacyPatientId: 'p-low', weight: '25', rawData: '{}' },
      { legacyPatientId: 'p-high', weight: '450', rawData: '{}' },
      { legacyPatientId: 'p-ok', weight: '82.5', rawData: '{}' },
      { legacyPatientId: 'p-edge', weight: '400', rawData: '{}' },
      { legacyPatientId: 'p-messy', weight: '82,5', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('flags a clean number under 30 or over 400, and leaves a plausible or unclean one alone', async () => {
    const response = await p44.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-low')).toEqual({
      table: 'patient',
      legacyId: 'p-low',
      column: 'weight',
      prev: '25',
      next: null,
    });
    expect(byId.get('p-high')).toEqual({
      table: 'patient',
      legacyId: 'p-high',
      column: 'weight',
      prev: '450',
      next: null,
    });

    // Plausible, exactly on the boundary, or not a clean number at all — that
    // last one is P41's or P43's business, not this rule's.
    expect(byId.has('p-ok')).toBe(false);
    expect(byId.has('p-edge')).toBe(false);
    expect(byId.has('p-messy')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(p44.ambiguous).toBe(true);
  });
});
