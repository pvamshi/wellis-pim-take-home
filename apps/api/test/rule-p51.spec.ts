import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p51 } from '../src/rules/catalogue/p51';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P51 — a patient height expressed in feet and inches', () => {
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
      { legacyPatientId: 'p-quote', heightCm: `5'10"`, rawData: '{}' },
      { legacyPatientId: 'p-word', heightCm: '5 ft 10', rawData: '{}' },
      { legacyPatientId: 'p-plausible', heightCm: '175', rawData: '{}' },
      { legacyPatientId: 'p-metres', heightCm: '1.75', rawData: '{}' },
      { legacyPatientId: 'p-comma', heightCm: '175,5', rawData: '{}' },
      { legacyPatientId: 'p-empty', heightCm: '', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the centimetre value for feet and inches, and leaves the rest alone', async () => {
    const response = await p51.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-quote')).toEqual({
      table: 'patient',
      legacyId: 'p-quote',
      column: 'height_cm',
      prev: `5'10"`,
      next: '177.8',
    });
    expect(byId.get('p-word')).toEqual({
      table: 'patient',
      legacyId: 'p-word',
      column: 'height_cm',
      prev: '5 ft 10',
      next: '177.8',
    });

    // A bare number in either shape (P50's or plausible already) and a
    // comma decimal (P49's) are not this rule's shape at all.
    expect(byId.has('p-plausible')).toBe(false);
    expect(byId.has('p-metres')).toBe(false);
    expect(byId.has('p-comma')).toBe(false);
    expect(byId.has('p-empty')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(p51.ambiguous).toBe(false);
  });
});
