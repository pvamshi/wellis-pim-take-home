import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { c10 } from '../src/rules/catalogue/c10';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe("C10 — a consent timestamp earlier than the patient's signup date", () => {
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
    const consents: Repository<LegacyConsent> = dataSource.getRepository(LegacyConsent);
    context = createRuleContext(dataSource.manager);

    await patients.save([
      { legacyPatientId: 'rec-real', signupDate: '2020-06-15', rawData: '{}' },
      { legacyPatientId: 'rec-fine', signupDate: '2000-01-01', rawData: '{}' },
      { legacyPatientId: 'rec-same-day', signupDate: '2000-01-01', rawData: '{}' },
      { legacyPatientId: 'rec-no-signup', signupDate: null, rawData: '{}' },
      // Same legacy id twice (1.0.3): one signup after the event, one
      // before, so the finding cannot hold against every matching patient.
      { legacyPatientId: 'rec-dup', signupDate: '2025-01-01', rawData: '{}' },
      { legacyPatientId: 'rec-dup', signupDate: '2000-01-01', rawData: '{}' },
    ]);

    await consents.save([
      { legacyPatientId: 'rec-real', action: 'granted', at: '2000-01-01T08:00:00', rawData: '{}' },
      { legacyPatientId: 'rec-fine', action: 'granted', at: '2020-06-15', rawData: '{}' },
      { legacyPatientId: 'rec-same-day', action: 'granted', at: '2000-01-01', rawData: '{}' },
      { legacyPatientId: 'rec-no-signup', action: 'granted', at: '2000-01-01', rawData: '{}' },
      { legacyPatientId: 'rec-real', action: 'granted', at: 'not-a-date', rawData: '{}' },
      { legacyPatientId: 'rec-real', action: 'granted', at: null, rawData: '{}' },
      { legacyPatientId: 'rec-missing', action: 'granted', at: '2000-01-01', rawData: '{}' },
      // Padded but would match once trimmed — C01's fix, not this rule's.
      { legacyPatientId: ' rec-real', action: 'granted', at: '2000-01-01', rawData: '{}' },
      // No reference to check at all — C03's finding.
      { legacyPatientId: '   ', action: 'granted', at: '2000-01-01', rawData: '{}' },
      { legacyPatientId: 'rec-dup', action: 'granted', at: '2010-01-01', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it("reports an event date every reading of which precedes the matched patient's signup date, proposing nothing", async () => {
    const response = await c10.run(context);
    const byPrevAt = new Map(response.updates.map((update) => [update.prev, update]));

    expect(byPrevAt.get('2000-01-01T08:00:00')).toEqual({
      table: 'consent',
      legacyId: 'rec-real',
      column: 'at',
      prev: '2000-01-01T08:00:00',
      next: null,
    });

    // Signed up after the event, the same day, no signup to compare
    // against, an unparseable or missing event date, and a patient
    // reference that is missing, padded or blank.
    const touched = response.updates.map((update) => update.prev);
    expect(touched).not.toContain('2020-06-15');
    expect(touched.filter((prev) => prev === '2000-01-01')).toHaveLength(0);
    expect(response.updates.some((update) => update.legacyId === 'rec-no-signup')).toBe(false);
    expect(response.updates.some((update) => update.prev === 'not-a-date')).toBe(false);
    expect(response.updates.some((update) => update.prev === null)).toBe(false);
    expect(response.updates.some((update) => update.legacyId === 'rec-missing')).toBe(false);
    expect(response.updates.some((update) => update.legacyId === ' rec-real')).toBe(false);
    expect(response.updates.some((update) => update.legacyId === '   ')).toBe(false);

    // Two patient rows share the same legacy id; one has a later signup date
    // and one an earlier one, so the finding cannot hold for every match.
    expect(response.updates.some((update) => update.legacyId === 'rec-dup')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(c10.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(c10);
  });
});
