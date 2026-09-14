import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { c05 } from '../src/rules/catalogue/c05';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('C05 — a consent action written in a recognised, non-canonical spelling', () => {
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
      { legacyPatientId: 'rec-case', action: 'Granted', rawData: '{}' },
      { legacyPatientId: 'rec-dutch', action: 'ingetrokken', rawData: '{}' },
      { legacyPatientId: 'rec-padded', action: 'granted ', rawData: '{}' }, // trailing space — proves the trim
      { legacyPatientId: 'rec-canonical', action: 'revoked', rawData: '{}' }, // already canonical
      { legacyPatientId: 'rec-unrecognised', action: 'pending', rawData: '{}' }, // C06's territory
      { legacyPatientId: 'rec-null', action: null, rawData: '{}' }, // C06's territory
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a recognised action spelling and proposes the canonical value', async () => {
    const response = await c05.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    // rec-padded is a same-case value with only whitespace differing from
    // canonical — it proves the lookup trims, not just lower-cases.
    for (const [id, prev, next] of [
      ['rec-case', 'Granted', 'granted'],
      ['rec-dutch', 'ingetrokken', 'revoked'],
      ['rec-padded', 'granted ', 'granted'],
    ] as const) {
      expect(byId.get(id)).toEqual({ table: 'consent', legacyId: id, column: 'action', prev, next });
    }

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('rec-canonical');
    expect(touched).not.toContain('rec-unrecognised');
    expect(touched).not.toContain('rec-null');

    expect(response.ambiguity).toBe(false);
    expect(c05.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(c05);
  });
});
