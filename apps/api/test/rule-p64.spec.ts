import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p64 } from '../src/rules/catalogue/p64';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P64 — a patient source with whitespace or inconsistent casing', () => {
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
      { legacyPatientId: 'p-padded', source: ' Web ', rawData: '{}' },
      { legacyPatientId: 'p-shouty', source: 'REFERRAL', rawData: '{}' },
      { legacyPatientId: 'p-clean', source: 'web', rawData: '{}' },
      { legacyPatientId: 'p-null', source: null, rawData: '{}' },
      // Trims away to nothing — P65's finding, not this rule's.
      { legacyPatientId: 'p-blank', source: '   ', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the trimmed, lower-cased source and leaves the rest alone', async () => {
    const response = await p64.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-padded')).toEqual({
      table: 'patient',
      legacyId: 'p-padded',
      column: 'source',
      prev: ' Web ',
      next: 'web',
    });
    expect(byId.get('p-shouty')?.next).toBe('referral');

    expect(byId.has('p-clean')).toBe(false);
    expect(byId.has('p-null')).toBe(false);
    expect(byId.has('p-blank')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(p64.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(p64);
  });
});
