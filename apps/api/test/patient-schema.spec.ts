import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/** B1: `patient` and `consent_event`'s own `CHECK` constraints and indices (2.1.1, 2.1.2) — the state machine's transition/insert triggers have their own suite in `intake-state-machine.spec.ts`. */
describe('patient and consent_event schema', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await app.close();

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }

    database.cleanup();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM consent_event`);
    await dataSource.query(`DELETE FROM patient`);
  });

  /** A minimal, valid `patient` row — every NOT NULL column filled, unless a test overrides one. */
  function basePatient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const id = randomUUID();
    const now = new Date().toISOString();

    return {
      id,
      intake_status: 'draft',
      origin: 'intake',
      full_name: 'Ada Lovelace',
      email: `${id}@example.com`,
      date_of_birth: '1990-01-01',
      account_status: 'prospect',
      created_at: now,
      updated_at: now,
      ...overrides,
    };
  }

  async function insertPatient(row: Record<string, unknown>): Promise<unknown> {
    const columns = Object.keys(row);

    return dataSource.query(
      `INSERT INTO patient (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map((column) => row[column]),
    );
  }

  it('accepts a minimal, valid row', async () => {
    await expect(insertPatient(basePatient())).resolves.toBeDefined();
  });

  describe('intake_status CHECK', () => {
    it('rejects a status outside the 8 named in 2.2', async () => {
      await expect(insertPatient(basePatient({ intake_status: 'pending' }))).rejects.toThrow();
    });
  });

  describe('origin CHECK', () => {
    it('accepts intake and legacy', async () => {
      await expect(insertPatient(basePatient({ origin: 'intake' }))).resolves.toBeDefined();
      await expect(
        insertPatient(basePatient({ origin: 'legacy', intake_status: 'submitted' })),
      ).resolves.toBeDefined();
    });

    it('rejects anything else', async () => {
      await expect(insertPatient(basePatient({ origin: 'referral' }))).rejects.toThrow();
    });
  });

  describe('account_status CHECK', () => {
    it('accepts each of active, paused, churned, prospect', async () => {
      for (const status of ['active', 'paused', 'churned', 'prospect']) {
        await expect(insertPatient(basePatient({ account_status: status }))).resolves.toBeDefined();
      }
    });

    it('rejects anything else', async () => {
      await expect(insertPatient(basePatient({ account_status: 'trial' }))).rejects.toThrow();
    });
  });

  describe('sex CHECK', () => {
    it('accepts null, M and F', async () => {
      await expect(insertPatient(basePatient({ sex: null }))).resolves.toBeDefined();
      await expect(insertPatient(basePatient({ sex: 'M' }))).resolves.toBeDefined();
      await expect(insertPatient(basePatient({ sex: 'F' }))).resolves.toBeDefined();
    });

    it('rejects anything else', async () => {
      await expect(insertPatient(basePatient({ sex: 'X' }))).rejects.toThrow();
      await expect(insertPatient(basePatient({ sex: 'm' }))).rejects.toThrow();
    });
  });

  describe('uq_patient_email_non_draft (2.1.1: one submitted patient per email, drafts may share)', () => {
    it('allows two drafts with the same email', async () => {
      const email = 'shared@example.com';

      await expect(insertPatient(basePatient({ email }))).resolves.toBeDefined();
      await expect(insertPatient(basePatient({ email }))).resolves.toBeDefined();
    });

    it('refuses a second non-draft row with an email a non-draft row already holds', async () => {
      const email = 'taken@example.com';
      const submitted = { email, origin: 'legacy', intake_status: 'submitted' };

      await expect(insertPatient(basePatient(submitted))).resolves.toBeDefined();
      await expect(insertPatient(basePatient(submitted))).rejects.toThrow();
    });

    it('allows a draft and a submitted row to share an email', async () => {
      const email = 'mixed@example.com';

      await expect(insertPatient(basePatient({ email }))).resolves.toBeDefined();
      await expect(
        insertPatient(basePatient({ email, origin: 'legacy', intake_status: 'submitted' })),
      ).resolves.toBeDefined();
    });
  });

  describe('legacy_id unique', () => {
    it('refuses two rows with the same legacy_id', async () => {
      await expect(
        insertPatient(
          basePatient({ origin: 'legacy', intake_status: 'submitted', legacy_id: 'L-1' }),
        ),
      ).resolves.toBeDefined();
      await expect(
        insertPatient(
          basePatient({ origin: 'legacy', intake_status: 'submitted', legacy_id: 'L-1' }),
        ),
      ).rejects.toThrow();
    });

    it('allows any number of null legacy_ids (every intake row)', async () => {
      await expect(insertPatient(basePatient({ legacy_id: null }))).resolves.toBeDefined();
      await expect(insertPatient(basePatient({ legacy_id: null }))).resolves.toBeDefined();
    });
  });

  describe('consent_event', () => {
    async function seedPatient(): Promise<string> {
      const patient = basePatient();
      await insertPatient(patient);
      return patient.id as string;
    }

    function baseConsent(
      patientId: string,
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        id: randomUUID(),
        patient_id: patientId,
        type: 'data_processing',
        action: 'granted',
        version: 'dp-2026.1',
        at: new Date().toISOString(),
        origin: 'intake',
        ...overrides,
      };
    }

    async function insertConsent(row: Record<string, unknown>): Promise<unknown> {
      const columns = Object.keys(row);

      return dataSource.query(
        `INSERT INTO consent_event (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        columns.map((column) => row[column]),
      );
    }

    it('accepts a minimal, valid row', async () => {
      const patientId = await seedPatient();

      await expect(insertConsent(baseConsent(patientId))).resolves.toBeDefined();
    });

    it('rejects a type other than data_processing', async () => {
      const patientId = await seedPatient();

      await expect(insertConsent(baseConsent(patientId, { type: 'marketing' }))).rejects.toThrow();
    });

    it('accepts granted and revoked, rejects anything else', async () => {
      const patientId = await seedPatient();

      await expect(
        insertConsent(baseConsent(patientId, { action: 'granted' })),
      ).resolves.toBeDefined();
      await expect(
        insertConsent(baseConsent(patientId, { action: 'revoked' })),
      ).resolves.toBeDefined();
      await expect(insertConsent(baseConsent(patientId, { action: 'declined' }))).rejects.toThrow();
    });

    it('accepts intake and legacy origin, rejects anything else', async () => {
      const patientId = await seedPatient();

      await expect(
        insertConsent(baseConsent(patientId, { origin: 'intake' })),
      ).resolves.toBeDefined();
      await expect(
        insertConsent(baseConsent(patientId, { origin: 'legacy' })),
      ).resolves.toBeDefined();
      await expect(insertConsent(baseConsent(patientId, { origin: 'referral' }))).rejects.toThrow();
    });

    it('allows many events for one patient (append-only history, 2.1.2)', async () => {
      const patientId = await seedPatient();

      await insertConsent(baseConsent(patientId, { action: 'granted' }));
      await insertConsent(baseConsent(patientId, { action: 'revoked' }));

      const rows = await dataSource.query<{ action: string }[]>(
        `SELECT action FROM consent_event WHERE patient_id = ? ORDER BY at`,
        [patientId],
      );

      expect(rows.map((row) => row.action)).toEqual(['granted', 'revoked']);
    });
  });
});
