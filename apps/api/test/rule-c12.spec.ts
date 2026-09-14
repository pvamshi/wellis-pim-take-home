import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { c12 } from '../src/rules/catalogue/c12';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('C12 — a recognised consent version, made canonical', () => {
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
    const consents: Repository<LegacyConsent> = dataSource.getRepository(LegacyConsent);
    context = createRuleContext(dataSource.manager);

    await consents.save([
      { legacyPatientId: 'rec-upper', action: 'granted', version: 'V2', rawData: '{}' },
      { legacyPatientId: 'rec-bare-number', action: 'granted', version: '2', rawData: '{}' },
      { legacyPatientId: 'rec-word', action: 'granted', version: 'version 1', rawData: '{}' },
      { legacyPatientId: 'rec-decimal', action: 'granted', version: 'v2.0', rawData: '{}' },
      { legacyPatientId: 'rec-canonical', action: 'granted', version: 'v1', rawData: '{}' },
      { legacyPatientId: 'rec-unknown-version', action: 'granted', version: 'v9', rawData: '{}' },
      { legacyPatientId: 'rec-garbage', action: 'granted', version: 'final', rawData: '{}' },
      { legacyPatientId: 'rec-empty', action: 'granted', version: '', rawData: '{}' },
      { legacyPatientId: 'rec-null', action: 'granted', version: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the canonical version for a loose spelling, and leaves the rest alone', async () => {
    const response = await c12.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('rec-upper')).toEqual({
      table: 'consent',
      legacyId: 'rec-upper',
      column: 'version',
      prev: 'V2',
      next: 'v2',
    });
    expect(byId.get('rec-bare-number')).toEqual({
      table: 'consent',
      legacyId: 'rec-bare-number',
      column: 'version',
      prev: '2',
      next: 'v2',
    });
    expect(byId.get('rec-word')).toEqual({
      table: 'consent',
      legacyId: 'rec-word',
      column: 'version',
      prev: 'version 1',
      next: 'v1',
    });
    expect(byId.get('rec-decimal')).toEqual({
      table: 'consent',
      legacyId: 'rec-decimal',
      column: 'version',
      prev: 'v2.0',
      next: 'v2',
    });

    // Already canonical, a version-shaped label naming none this export has,
    // free text nobody recognises, and empty or absent are all walked past.
    expect(byId.has('rec-canonical')).toBe(false);
    expect(byId.has('rec-unknown-version')).toBe(false);
    expect(byId.has('rec-garbage')).toBe(false);
    expect(byId.has('rec-empty')).toBe(false);
    expect(byId.has('rec-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(c12.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(c12);
  });
});
