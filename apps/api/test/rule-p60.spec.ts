import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p60 } from '../src/rules/catalogue/p60';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P60 — a patient signup date that reads as a date both ways round', () => {
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
      { legacyPatientId: 'p-slash-both', signupDate: '03/04/2023', rawData: '{}' },
      { legacyPatientId: 'p-dash-both', signupDate: '03-04-2023', rawData: '{}' },
      { legacyPatientId: 'p-slash-certain', signupDate: '02/16/2023', rawData: '{}' },
      { legacyPatientId: 'p-dash-certain', signupDate: '14-08-2023', rawData: '{}' },
      { legacyPatientId: 'p-zero', signupDate: '00-05-2023', rawData: '{}' },
      { legacyPatientId: 'p-iso', signupDate: '2023-02-16', rawData: '{}' },
      { legacyPatientId: 'p-null', signupDate: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a two-way date with no proposed value, whichever separator it used', async () => {
    const response = await p60.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-slash-both')).toEqual({
      table: 'patient',
      legacyId: 'p-slash-both',
      column: 'signup_date',
      prev: '03/04/2023',
      next: null,
    });
    expect(byId.get('p-dash-both')).toEqual({
      table: 'patient',
      legacyId: 'p-dash-both',
      column: 'signup_date',
      prev: '03-04-2023',
      next: null,
    });

    // A number above 12 makes the order certain — P58's fix on the slash
    // spelling, P59's on the dash. A zero and an ISO date are neither.
    expect(byId.has('p-slash-certain')).toBe(false);
    expect(byId.has('p-dash-certain')).toBe(false);
    expect(byId.has('p-zero')).toBe(false);
    expect(byId.has('p-iso')).toBe(false);
    expect(byId.has('p-null')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(p60.ambiguous).toBe(true);
  });
});
