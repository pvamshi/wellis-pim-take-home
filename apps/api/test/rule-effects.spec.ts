import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { LegacyPatientRule } from '../src/legacy/legacy-rule.entity';
import { Patient } from '../src/patient/patient.entity';
import type { RuleEffectsResponse } from '../src/rule-effects/rule-effects.controller';
import type { RegisteredRule, RuleContext } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * 1.5.3 over HTTP: two fake versions of one phone rule, run against seeded
 * patients whose recorded findings cover every way a new finding can land.
 *
 * v1 strips dashes from any phone holding one. v2 strips dashes and spaces,
 * and leaves international numbers (a leading +) alone.
 */
function phoneRule(version: number, strip: RegExp, skipInternational: boolean): RegisteredRule {
  return {
    ruleId: 'R-FX',
    version,
    run: async (context: RuleContext) => {
      const patients = await context.find(LegacyPatient);
      const updates = patients
        .filter((patient) => patient.phone !== null && strip.test(patient.phone))
        .filter((patient) => !(skipInternational && patient.phone?.startsWith('+')))
        .map((patient) => ({
          table: 'patient' as const,
          legacyId: patient.legacyPatientId,
          column: 'phone',
          prev: patient.phone,
          next: (patient.phone ?? '').replace(new RegExp(strip.source, 'g'), ''),
        }));

      return { ambiguity: false, updates };
    },
  };
}

const fakeRules: RegisteredRule[] = [phoneRule(1, /-/, false), phoneRule(2, /[- ]/, true)];

describe('the effects of a changed rule (1.5.3)', () => {
  let app: INestApplication;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;

  async function effects(query = ''): Promise<{ status: number; body: RuleEffectsResponse }> {
    const response = await request(app.getHttpServer()).get(`/rules/R-FX/effects${query}`);
    return { status: response.status, body: response.body as RuleEffectsResponse };
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RuleRegistry)
      .useValue(new RuleRegistry(fakeRules))
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const dataSource = moduleRef.get(DataSource);

    const phones: Record<string, string> = {
      'P-NEW': '06 1234', // v2 only
      'P-CHANGED': '06-12 34', // both, different proposals
      'P-SAME': '06-1234', // both, same proposal; v1 finding still pending
      'P-GONE': '+31-6', // v1 only
      'P-DECLINED': '06-99', // both; declined under v1
      'P-IMPORTED': '06-55', // both; already imported
    };

    await dataSource.getRepository(LegacyPatient).save(
      Object.entries(phones).map(([legacyPatientId, phone]) => ({
        legacyPatientId,
        phone,
        rawData: `{"id":"${legacyPatientId}"}`,
      })),
    );

    await dataSource.getRepository(LegacyPatientRule).insert([
      {
        legacyId: 'P-SAME',
        ruleId: 'R-FX',
        version: 1,
        column: 'phone',
        previousValue: '06-1234',
        nextValue: '061234',
        status: 'pending',
        reason: null,
      },
      {
        legacyId: 'P-DECLINED',
        ruleId: 'R-FX',
        version: 1,
        column: 'phone',
        previousValue: '06-99',
        nextValue: '0699',
        status: 'declined',
        reason: null,
      },
    ]);

    const now = new Date().toISOString();
    await dataSource.getRepository(Patient).insert({
      intakeStatus: 'submitted',
      origin: 'legacy',
      fullName: 'Imported Patient',
      email: 'imported@example.com',
      dateOfBirth: '1980-01-01',
      accountStatus: 'active',
      legacyId: 'P-IMPORTED',
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('compares the newest version with the one before, writing nothing', async () => {
    const { status, body } = await effects();

    expect(status).toBe(200);
    expect(body).toMatchObject({
      ruleId: 'R-FX',
      from: 1,
      to: 2,
      foundBefore: 5,
      foundAfter: 5,
      unchanged: 3,
      alreadyRecorded: 0,
      onImportedPatients: 1,
      rowsBecomingPending: 2,
    });

    const ids = (group: { examples: { legacyId: string }[] }) =>
      group.examples.map((example) => example.legacyId).sort();

    expect(ids(body.newlyFound)).toEqual(['P-NEW']);
    expect(ids(body.noLongerFound)).toEqual(['P-GONE']);
    expect(body.proposalChanged.examples).toEqual([
      {
        table: 'patient',
        legacyId: 'P-CHANGED',
        column: 'phone',
        current: '06-12 34',
        before: '0612 34',
        after: '061234',
      },
    ]);
    expect(ids(body.wouldRecord)).toEqual(['P-CHANGED', 'P-NEW', 'P-SAME']);
    expect(ids(body.declinedEarlier)).toEqual(['P-DECLINED']);
    expect(ids(body.oldPendingLeft)).toEqual(['P-SAME']);

    const recorded = await app.get(DataSource).getRepository(LegacyPatientRule).count();
    expect(recorded).toBe(2);
  });

  it('compares a first version with nothing', async () => {
    const { status, body } = await effects('?to=1');

    expect(status).toBe(200);
    expect(body).toMatchObject({ from: null, to: 1, foundBefore: 0, foundAfter: 5 });
    expect(body.newlyFound.count).toBe(5);
  });

  it('answers 404 for a rule with no code and 400 for a version it does not have', async () => {
    const missing = await request(app.getHttpServer()).get('/rules/R-NONE/effects');
    expect(missing.status).toBe(404);

    expect((await effects('?to=9')).status).toBe(400);
    expect((await effects('?from=2&to=2')).status).toBe(400);
    expect((await effects('?from=zero')).status).toBe(400);
  });
});
