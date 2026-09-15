import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { d02V2 } from '../src/rules/catalogue/d02-v2';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('D02 v2 — two patients sharing the same cleaned BSN, both rows named', () => {
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
      { legacyPatientId: 'pat-first', bsn: '12345678', rawData: '{}' },
      { legacyPatientId: 'pat-second', bsn: '0.123.456.78', rawData: '{}' },
      { legacyPatientId: 'pat-unrelated', bsn: '99988877', rawData: '{}' },
      { legacyPatientId: 'pat-unreadable', bsn: 'not-a-number', rawData: '{}' },
      { legacyPatientId: 'pat-null', bsn: null, rawData: '{}' },
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

  it('links a later row to the first row with the same cleaned BSN, naming both rows', async () => {
    const response = await d02V2.run(context);

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
    expect(d02V2.ambiguous).toBe(false);
    expect(d02V2.version).toBe(2);
    expect(ruleCatalogue).toContain(d02V2);
  });
});
