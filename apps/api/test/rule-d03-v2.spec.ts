import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { d03V2 } from '../src/rules/catalogue/d03-v2';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('D03 v2 — two patients sharing the same normalised name and dob, both rows named', () => {
  let app: INestApplication;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let context: RuleContext;
  let firstId: string;
  let secondId: string;

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

    const saved = await patients.save([
      { legacyPatientId: 'pat-first', fullName: 'Elena  Vos', dob: '1990-01-01', rawData: '{}' },
      { legacyPatientId: 'pat-second', fullName: ' elena vos ', dob: '1990-01-01', rawData: '{}' },
      {
        legacyPatientId: 'pat-unrelated',
        fullName: 'Someone Else',
        dob: '1985-05-05',
        rawData: '{}',
      },
      { legacyPatientId: 'pat-no-dob', fullName: 'Elena Vos', dob: null, rawData: '{}' },
    ]);
    firstId = saved[0].id;
    secondId = saved[1].id;
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('links a later row to the first row with the same name and dob, naming both rows', async () => {
    const response = await d03V2.run(context);

    expect(response.duplicates).toEqual([
      {
        table: 'patient',
        duplicateLegacyId: 'pat-second',
        duplicateRowId: secondId,
        canonicalLegacyId: 'pat-first',
        canonicalRowId: firstId,
      },
    ]);
    expect(response.updates).toEqual([]);
    expect(response.ambiguity).toBe(false);
    expect(d03V2.ambiguous).toBe(false);
    expect(d03V2.version).toBe(2);
    expect(ruleCatalogue).toContain(d03V2);
  });
});
