import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p65 } from '../src/rules/catalogue/p65';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('P65 — a patient source that is empty', () => {
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
      { legacyPatientId: 'p-null', source: null, rawData: '{}' },
      { legacyPatientId: 'p-empty', source: '', rawData: '{}' },
      { legacyPatientId: 'p-whitespace', source: '  \t', rawData: '{}' },
      { legacyPatientId: 'p-present', source: 'Web', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a missing or whitespace-only source, proposing nothing', async () => {
    const response = await p65.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-null')).toEqual({
      table: 'patient',
      legacyId: 'p-null',
      column: 'source',
      prev: null,
      next: null,
    });
    expect(byId.get('p-empty')?.prev).toBe('');
    expect(byId.get('p-whitespace')?.prev).toBe('  \t');

    expect(byId.has('p-present')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(p65.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(p65);
  });
});
