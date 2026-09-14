import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p59 } from '../src/rules/catalogue/p59';
import { createRuleContext } from '../src/rules/rule-context';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P59 — a patient signup date that is unambiguous but not ISO', () => {
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
      { legacyPatientId: 'p-certain', signupDate: '14-08-2023', rawData: '{}' },
      { legacyPatientId: 'p-both-le12', signupDate: '03-04-2023', rawData: '{}' },
      { legacyPatientId: 'p-slash', signupDate: '02/16/2023', rawData: '{}' },
      { legacyPatientId: 'p-no-month', signupDate: '31-13-1990', rawData: '{}' },
      { legacyPatientId: 'p-no-such-day', signupDate: '31-04-2023', rawData: '{}' },
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

  it('proposes the ISO date for a certain-order dash date, and leaves the rest alone', async () => {
    const response = await p59.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-certain')).toEqual({
      table: 'patient',
      legacyId: 'p-certain',
      column: 'signup_date',
      prev: '14-08-2023',
      next: '2023-08-14',
    });

    // Both numbers 12 or under (P60's), slash-spelled (P58's), no valid month
    // or day either way, already ISO, and no date at all.
    expect(byId.has('p-both-le12')).toBe(false);
    expect(byId.has('p-slash')).toBe(false);
    expect(byId.has('p-no-month')).toBe(false);
    expect(byId.has('p-no-such-day')).toBe(false);
    expect(byId.has('p-iso')).toBe(false);
    expect(byId.has('p-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(p59.ambiguous).toBe(false);
  });
});
