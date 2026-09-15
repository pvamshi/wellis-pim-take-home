import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { ConsentEvent } from '../src/consent/consent-event.entity';
import { Duplicate } from '../src/duplicates/duplicate.entity';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import {
  LegacyConsentRule,
  LegacyPatientRule,
  type LegacyRuleRow,
} from '../src/legacy/legacy-rule.entity';
import type { BulkImportRowResult } from '../src/legacy-patient-import/legacy-patient-import.service';
import { Patient } from '../src/patient/patient.entity';
import type { RowsListResponse } from '../src/rows-list/rows-list.controller';
import { RuleFindingsService } from '../src/rules/rule-findings.service';
import { RowRejection } from '../src/rows/row-rejection.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * B4: legacy import, individual and bulk (2.6, 2.9), over HTTP and against a
 * real database. Preconditions and mapping are exercised through the same
 * `legacy_patient`/`legacy_consent`/rule/`duplicate`/`row_rejection` fixtures
 * the rows and duplicates screens' own suites already seed through.
 */
describe('B4 legacy patient import', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let legacyPatients: Repository<LegacyPatient>;
  let legacyConsents: Repository<LegacyConsent>;
  let patientRules: Repository<LegacyPatientRule>;
  let consentRules: Repository<LegacyConsentRule>;
  let duplicates: Repository<Duplicate>;
  let rejections: Repository<RowRejection>;
  let patients: Repository<Patient>;

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    dataSource = moduleRef.get(DataSource);
    legacyPatients = dataSource.getRepository(LegacyPatient);
    legacyConsents = dataSource.getRepository(LegacyConsent);
    patientRules = dataSource.getRepository(LegacyPatientRule);
    consentRules = dataSource.getRepository(LegacyConsentRule);
    duplicates = dataSource.getRepository(Duplicate);
    rejections = dataSource.getRepository(RowRejection);
    patients = dataSource.getRepository(Patient);
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
    await dataSource.query(`DELETE FROM legacy_patient_rule`);
    await dataSource.query(`DELETE FROM legacy_consent_rule`);
    await dataSource.query(`DELETE FROM duplicate`);
    await dataSource.query(`DELETE FROM row_rejection`);
    await dataSource.query(`DELETE FROM consent_event`);
    await dataSource.query(`DELETE FROM patient`);
    await dataSource.query(`DELETE FROM legacy_consent`);
    await dataSource.query(`DELETE FROM legacy_patient`);
  });

  function yearsAgo(years: number): string {
    const date = new Date();
    date.setUTCFullYear(date.getUTCFullYear() - years);
    return date.toISOString().slice(0, 10);
  }

  let emailCounter = 0;

  function freshEmail(): string {
    emailCounter += 1;
    return `legacy-${emailCounter}@example.com`;
  }

  /** A clean legacy patient row — every field an "Import clean" row would carry, unless overridden. BMI (90/1.7^2 = 31.1) sits outside 27-30, so E3 never has an opinion. */
  async function seedCleanPatient(
    legacyId: string,
    overrides: Partial<LegacyPatient> = {},
  ): Promise<LegacyPatient> {
    return await legacyPatients.save({
      legacyPatientId: legacyId,
      fullName: 'Jane Doe',
      email: freshEmail(),
      dob: yearsAgo(36),
      sex: 'F',
      bsn: null,
      phone: null,
      city: 'Amsterdam',
      weight: '90',
      weightUnit: 'kg',
      heightCm: '170',
      status: 'prospect',
      signupDate: yearsAgo(1),
      source: 'Referral',
      rawData: '{}',
      ...overrides,
    });
  }

  async function seedConsent(
    legacyId: string,
    overrides: Partial<LegacyConsent> = {},
  ): Promise<LegacyConsent> {
    return await legacyConsents.save({
      legacyPatientId: legacyId,
      type: 'data_processing',
      action: 'granted',
      at: '2024-01-01T00:00:00.000Z',
      version: 'v1',
      rawData: '{}',
      ...overrides,
    });
  }

  async function importOne(legacyId: string, actor = 'Priya'): Promise<request.Response> {
    return await request(app.getHttpServer())
      .post(`/rows/patient/${legacyId}/import`)
      .send({ actor });
  }

  // --- happy path ------------------------------------------------------------

  it('imports a clean row, landing auto_flagged or auto_rejected, never auto_cleared', async () => {
    await seedCleanPatient('L-CLEAN');
    await seedConsent('L-CLEAN');

    const response = await importOne('L-CLEAN');

    expect(response.status).toBe(200);
    expect(['auto_flagged', 'auto_rejected']).toContain(response.body.intakeStatus);

    const patient = await patients.findOneByOrFail({ id: response.body.patientId });
    expect(patient.origin).toBe('legacy');
    expect(patient.legacyId).toBe('L-CLEAN');
    expect(patient.intakeStatus).not.toBe('auto_cleared');
    expect(patient.rulesetVersion).toBe('elig-1');
    expect(patient.evaluation).toHaveLength(6);
  });

  it('brings the consent events along, minus a confirmed-duplicate consent row', async () => {
    await seedCleanPatient('L-CONSENT');
    const kept = await seedConsent('L-CONSENT', { at: '2024-01-01T00:00:00.000Z' });
    const skipped = await seedConsent('L-CONSENT', {
      action: 'revoked',
      at: '2023-01-01T00:00:00.000Z',
    });

    await duplicates.save({
      sourceTable: 'consent',
      duplicateLegacyId: 'L-CONSENT',
      duplicateRowId: skipped.id,
      canonicalLegacyId: 'L-CONSENT',
      canonicalRowId: kept.id,
      ruleId: 'D05',
      version: 2,
      status: 'confirmed',
    });

    const response = await importOne('L-CONSENT');
    expect(response.status).toBe(200);

    const events = await dataSource
      .getRepository(ConsentEvent)
      .find({ where: { patientId: response.body.patientId } });

    expect(events).toHaveLength(1);
    expect(events[0].legacyRowId).toBe(kept.id);
    expect(events[0].action).toBe('granted');
  });

  it("maps the latest legacy intake's meds/conditions onto other_medications/other_conditions", async () => {
    await seedCleanPatient('L-INTAKE');
    const intakes = dataSource.getRepository(LegacyIntake);
    await intakes.save({
      legacyIntakeId: 'I-1',
      legacyPatientId: 'L-INTAKE',
      submittedAt: '2023-01-01T00:00:00.000Z',
      medsCurrent: 'old meds',
      conditions: 'old conditions',
      rawData: '{}',
    });
    await intakes.save({
      legacyIntakeId: 'I-2',
      legacyPatientId: 'L-INTAKE',
      submittedAt: '2024-06-01T00:00:00.000Z',
      medsCurrent: 'ibuprofen',
      conditions: 'mild asthma',
      rawData: '{}',
    });

    const response = await importOne('L-INTAKE');
    expect(response.status).toBe(200);

    const patient = await patients.findOneByOrFail({ id: response.body.patientId });
    expect(patient.otherMedications).toBe('ibuprofen');
    expect(patient.otherConditions).toBe('mild asthma');
    // Free text is never parsed into answers (2.6, I26/I29).
    expect(patient.glp1Current).toBeNull();
    expect(patient.weightConditions).toBeNull();
    expect(patient.thyroidCancerHistory).toBeNull();
    expect(patient.pancreatitisHistory).toBeNull();
  });

  // --- validation --------------------------------------------------------

  it('422s invalid data with every field error, writing nothing', async () => {
    await seedCleanPatient('L-BAD', {
      email: 'not-an-email',
      dob: 'not-a-date',
      status: null,
    });

    const response = await importOne('L-BAD');

    expect(response.status).toBe(422);
    const fields = (response.body.errors as { field: string }[]).map((e) => e.field);
    expect(fields).toContain('email');
    expect(fields).toContain('date_of_birth');
    expect(fields).toContain('account_status');

    expect(await patients.count()).toBe(0);
    expect(await dataSource.getRepository(ConsentEvent).count()).toBe(0);
  });

  it('reports a taken email as a field error, not a 500', async () => {
    const takenEmail = freshEmail();
    await patients.save({
      id: randomUUID(),
      intakeStatus: 'submitted',
      origin: 'legacy',
      fullName: 'Existing Patient',
      email: takenEmail,
      dateOfBirth: yearsAgo(40),
      accountStatus: 'prospect',
      createdAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      legacyId: 'L-EXISTING',
    });

    await seedCleanPatient('L-TAKEN-EMAIL', { email: takenEmail });

    const response = await importOne('L-TAKEN-EMAIL');

    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual([expect.objectContaining({ field: 'email' })]);

    const imported = await patients.findOneBy({ legacyId: 'L-TAKEN-EMAIL' });
    expect(imported).toBeNull();
  });

  // --- preconditions -------------------------------------------------------

  describe('each precondition', () => {
    it('409s a legacy id nothing names', async () => {
      const response = await importOne('L-NOWHERE');
      expect(response.status).toBe(409);
    });

    it('409s a legacy id naming more than one data row', async () => {
      await seedCleanPatient('L-DUP');
      await seedCleanPatient('L-DUP');

      const response = await importOne('L-DUP');
      expect(response.status).toBe(409);
    });

    it('409s a row already imported', async () => {
      await seedCleanPatient('L-ALREADY');
      const first = await importOne('L-ALREADY');
      expect(first.status).toBe(200);

      const second = await importOne('L-ALREADY');
      expect(second.status).toBe(409);
    });

    it('409s a row that is Import rejected', async () => {
      await seedCleanPatient('L-REJECTED');
      await rejections.save({ table: 'patient', legacyId: 'L-REJECTED', reason: 'beyond repair' });

      const response = await importOne('L-REJECTED');
      expect(response.status).toBe(409);
    });

    it('409s a row with a pending finding against the patient row', async () => {
      await seedCleanPatient('L-PENDING-PATIENT');
      await seedPendingFinding(patientRules, 'L-PENDING-PATIENT');

      const response = await importOne('L-PENDING-PATIENT');
      expect(response.status).toBe(409);
    });

    it('409s a row whose consent row has a pending finding', async () => {
      await seedCleanPatient('L-PENDING-CONSENT');
      await seedConsent('L-PENDING-CONSENT');
      await seedPendingFinding(consentRules, 'L-PENDING-CONSENT');

      const response = await importOne('L-PENDING-CONSENT');
      expect(response.status).toBe(409);
    });

    it('409s a row named by a pending duplicate link, on either side', async () => {
      const x = await seedCleanPatient('L-LINK-X');
      const y = await seedCleanPatient('L-LINK-Y');

      await duplicates.save({
        sourceTable: 'patient',
        duplicateLegacyId: 'L-LINK-X',
        duplicateRowId: x.id,
        canonicalLegacyId: 'L-LINK-Y',
        canonicalRowId: y.id,
        ruleId: 'D01',
        version: 2,
        status: 'pending',
      });

      const xResponse = await importOne('L-LINK-X');
      expect(xResponse.status).toBe(409);

      const yResponse = await importOne('L-LINK-Y');
      expect(yResponse.status).toBe(409);
    });
  });

  async function seedPendingFinding(
    repository: Repository<LegacyRuleRow>,
    legacyId: string,
  ): Promise<void> {
    await repository.insert({
      legacyId,
      ruleId: 'R-B4-SEED',
      version: 1,
      column: 'phone',
      previousValue: null,
      nextValue: null,
      status: 'pending',
      reason: null,
    });
  }

  // --- bulk ------------------------------------------------------------

  describe('POST /rows/import', () => {
    it('imports the good rows even when one row is bad', async () => {
      await seedCleanPatient('L-BULK-GOOD-1');
      await seedCleanPatient('L-BULK-GOOD-2');
      await seedCleanPatient('L-BULK-BAD', { email: 'not-an-email' });

      const response = await request(app.getHttpServer())
        .post('/rows/import')
        .send({ legacyIds: ['L-BULK-GOOD-1', 'L-BULK-BAD', 'L-BULK-GOOD-2'], actor: 'Priya' });

      expect(response.status).toBe(200);
      const results = response.body as BulkImportRowResult[];

      const byId = new Map(results.map((r) => [r.legacyId, r]));
      expect(byId.get('L-BULK-GOOD-1')?.imported).toBe(true);
      expect(byId.get('L-BULK-GOOD-2')?.imported).toBe(true);
      expect(byId.get('L-BULK-BAD')?.imported).toBe(false);

      expect(await patients.count({ where: { legacyId: 'L-BULK-GOOD-1' } })).toBe(1);
      expect(await patients.count({ where: { legacyId: 'L-BULK-GOOD-2' } })).toBe(1);
      expect(await patients.count({ where: { legacyId: 'L-BULK-BAD' } })).toBe(0);
    });

    it('reports a precondition failure as field: null in the bulk errors array', async () => {
      const response = await request(app.getHttpServer())
        .post('/rows/import')
        .send({ legacyIds: ['L-BULK-NOWHERE'], actor: 'Priya' });

      expect(response.status).toBe(200);
      const [result] = response.body as BulkImportRowResult[];
      expect(result.imported).toBe(false);
      expect((result as { errors: { field: null }[] }).errors).toEqual([
        expect.objectContaining({ field: null, value: null }),
      ]);
    });

    it('400s a malformed bulk request', async () => {
      const response = await request(app.getHttpServer())
        .post('/rows/import')
        .send({ legacyIds: [], actor: 'Priya' });

      expect(response.status).toBe(400);
    });
  });

  // --- rows screen -------------------------------------------------------

  it('shows Imported on the rows list, taking precedence over pending', async () => {
    await seedCleanPatient('L-ROWS-SHOW');

    const imported = await importOne('L-ROWS-SHOW');
    expect(imported.status).toBe(200);

    // A finding recorded after import — the state must not fall back to pending.
    await seedPendingFinding(patientRules, 'L-ROWS-SHOW');

    const response = await request(app.getHttpServer()).get('/rows').query({ table: 'patient' });

    expect(response.status).toBe(200);
    const row = (response.body as RowsListResponse).rows.find((r) => r.legacyId === 'L-ROWS-SHOW');
    expect(row?.state).toBe('imported');

    const filtered = await request(app.getHttpServer())
      .get('/rows')
      .query({ table: 'patient', state: 'imported' });
    expect((filtered.body as RowsListResponse).rows.map((r) => r.legacyId)).toContain(
      'L-ROWS-SHOW',
    );
  });

  it('records no finding and no duplicate link against an imported patient when rules run again', async () => {
    await seedCleanPatient('L-PERSIST');
    expect((await importOne('L-PERSIST')).status).toBe(200);

    const report = await app.get(RuleFindingsService).persist([
      {
        ruleId: 'P65',
        version: 1,
        response: {
          ambiguity: false,
          updates: [
            { table: 'patient', legacyId: 'L-PERSIST', column: 'source', prev: 'x', next: 'y' },
          ],
          duplicates: [
            {
              table: 'patient',
              duplicateLegacyId: 'L-PERSIST-X',
              canonicalLegacyId: 'L-PERSIST',
              duplicateRowId: randomUUID(),
              canonicalRowId: randomUUID(),
            },
          ],
        },
      },
    ]);

    expect(report[0]).toMatchObject({ found: 1, declined: 1, written: 0, linksSkipped: 1 });
    expect(await patientRules.countBy({ legacyId: 'L-PERSIST' })).toBe(0);
    expect(await duplicates.countBy({ canonicalLegacyId: 'L-PERSIST' })).toBe(0);
  });
});
