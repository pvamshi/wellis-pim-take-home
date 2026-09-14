import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { d03 } from '../src/rules/catalogue/d03';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('D03 — two patients sharing the same normalised name and dob', () => {
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
      { legacyPatientId: 'pat-first', fullName: 'Jan van der Berg', dob: '1990-05-01', rawData: '{}' },
      { legacyPatientId: 'pat-second', fullName: '  JAN   van der berg ', dob: '1990-05-01', rawData: '{}' },
      // Same name, different dob — not a match: the catalogue asks for the same dob, not a reparsed one.
      { legacyPatientId: 'pat-different-dob', fullName: 'Jan van der Berg', dob: '1991-05-01', rawData: '{}' },
      { legacyPatientId: 'pat-unrelated', fullName: 'Anna Smit', dob: '1985-02-14', rawData: '{}' },
      { legacyPatientId: 'pat-null-dob', fullName: 'Jan van der Berg', dob: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('links a later row to the first row with the same folded name and dob, and leaves the rest alone', async () => {
    const response = await d03.run(context);

    expect(response.duplicates).toEqual([
      {
        table: 'patient',
        duplicateLegacyId: 'pat-second',
        canonicalLegacyId: 'pat-first',
      },
    ]);
    expect(response.updates).toEqual([]);
    expect(response.ambiguity).toBe(false);
    expect(d03.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(d03);
  });
});
