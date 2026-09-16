import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AuditEvent } from '../src/audit/audit-event.entity';
import type { IntakeView } from '../src/intake/intake.service';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { INTAKE_STATUSES, type IntakeStatus } from '../src/patient/intake-status';
import { Patient } from '../src/patient/patient.entity';
import { QUEUE_STATUSES } from '../src/review/review.service';
import type { ReviewDetail, ReviewQueueEntry } from '../src/review/review.service';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * B3: the intake form's API (2.3, 2.9) and the review screen's API (2.4,
 * 2.9), over HTTP and against a real database.
 *
 * Every intake is driven the same way a patient would drive it — `POST
 * /intakes`, five `PATCH`es, `POST .../submit` — so a test that needs a
 * `submitted`/`auto_*` row builds one through the real endpoints rather than
 * seeding `patient` by hand, the way `legacy-import.spec.ts` drives the whole
 * import rather than asserting on internals.
 */
describe('B3 intake and review API', () => {
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
    await dataSource.query(`DELETE FROM legacy_consent`);
    await dataSource.query(`DELETE FROM legacy_patient`);
  });

  /** `YYYY-MM-DD`, `years` ago from today — old enough to always clear E1 (2.7), computed rather than hard-coded so the suite survives any run date. */
  function yearsAgo(years: number): string {
    const date = new Date();
    date.setUTCFullYear(date.getUTCFullYear() - years);
    return date.toISOString().slice(0, 10);
  }

  let emailCounter = 0;

  function freshEmail(): string {
    emailCounter += 1;
    return `patient-${emailCounter}@example.com`;
  }

  /** Every field every step needs, tuned to clear all six `elig-1` rules (BMI 34.6, outside 27-30.0) unless overridden. */
  function stepBodies(
    overrides: Record<string, unknown> = {},
  ): Record<number, Record<string, unknown>> {
    const merged = {
      full_name: 'Ada Lovelace',
      email: freshEmail(),
      date_of_birth: yearsAgo(30),
      height_cm: 170,
      weight_kg: 100,
      glp1_current: false,
      glp1_medications: [],
      other_medications: null,
      weight_conditions: ['none of these'],
      thyroid_cancer_history: false,
      pancreatitis_history: false,
      other_conditions: null,
      alcohol_units_week: 5,
      consent_data_processing: true,
      ...overrides,
    };

    return {
      1: { full_name: merged.full_name, email: merged.email, date_of_birth: merged.date_of_birth },
      2: { height_cm: merged.height_cm, weight_kg: merged.weight_kg },
      3: {
        glp1_current: merged.glp1_current,
        glp1_medications: merged.glp1_medications,
        other_medications: merged.other_medications,
      },
      4: {
        weight_conditions: merged.weight_conditions,
        thyroid_cancer_history: merged.thyroid_cancer_history,
        pancreatitis_history: merged.pancreatitis_history,
        other_conditions: merged.other_conditions,
        alcohol_units_week: merged.alcohol_units_week,
      },
      5: { consent_data_processing: merged.consent_data_processing },
    };
  }

  async function createDraft(
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; body: Record<number, Record<string, unknown>> }> {
    const body = stepBodies(overrides);
    const response = await request(app.getHttpServer()).post('/intakes').send(body[1]);

    expect(response.status).toBe(201);

    return { id: (response.body as IntakeView).id, body };
  }

  async function patchAllSteps(
    id: string,
    body: Record<number, Record<string, unknown>>,
  ): Promise<void> {
    for (const step of [2, 3, 4, 5] as const) {
      const response = await request(app.getHttpServer())
        .patch(`/intakes/${id}`)
        .send({ step, ...body[step] });

      expect(response.status).toBe(200);
    }
  }

  /** Drives a whole intake through to `submitted` -> `auto_*`, and returns its id and the submit response. */
  async function submitIntake(
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; response: request.Response }> {
    const { id, body } = await createDraft(overrides);
    await patchAllSteps(id, body);

    const response = await request(app.getHttpServer()).post(`/intakes/${id}/submit`);

    return { id, response };
  }

  async function auditEventsFor(id: string): Promise<AuditEvent[]> {
    return dataSource
      .getRepository(AuditEvent)
      .find({ where: { entityId: id }, order: { at: 'ASC' } });
  }

  let legacyIdCounter = 0;

  /** Seeds and imports one legacy-origin patient (2.6) — the only way a `patient.origin = 'legacy'` row exists, so the queue's origin filter needs one. */
  async function importLegacyPatient(): Promise<string> {
    legacyIdCounter += 1;
    const legacyId = `L-ORIGIN-${legacyIdCounter}`;

    await dataSource.getRepository(LegacyPatient).save({
      legacyPatientId: legacyId,
      fullName: 'Legacy Patient',
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
    });
    await dataSource.getRepository(LegacyConsent).save({
      legacyPatientId: legacyId,
      type: 'data_processing',
      action: 'granted',
      at: '2024-01-01T00:00:00.000Z',
      version: 'v1',
      rawData: '{}',
    });

    const response = await request(app.getHttpServer())
      .post(`/rows/patient/${legacyId}/import`)
      .send({ actor: 'Priya' });
    expect(response.status).toBe(200);

    return response.body.patientId as string;
  }

  /** Drives one intake as far as `in_review`. */
  async function startedIntake(): Promise<string> {
    const { id } = await submitIntake();

    const response = await request(app.getHttpServer())
      .post(`/review/intakes/${id}/start`)
      .send({ actor: 'Dr. Okafor' });
    expect(response.status).toBe(200);

    return id;
  }

  /** Drives one intake all the way to a reviewer's decision. */
  async function decidedIntake(decision: 'approved' | 'rejected'): Promise<string> {
    const id = await startedIntake();

    const response = await request(app.getHttpServer())
      .post(`/review/intakes/${id}/decide`)
      .send({ decision, note: 'decided in a test', actor: 'Dr. Okafor' });
    expect(response.status).toBe(200);

    return id;
  }

  /**
   * One patient resting in `submitted` — inserted, not driven.
   *
   * Both doors into that status, intake submit and legacy import, evaluate
   * and move the row on to `auto_*` in the same transaction, so no request
   * can leave one resting there. 2.2 has the status all the same, a crash
   * between those two writes would strand a row in it, and the queue is
   * asked to show every status there is. `legacy` is the origin because the
   * insert trigger admits no other one at `submitted`.
   */
  async function insertSubmittedPatient(): Promise<string> {
    const now = new Date().toISOString();
    const repository = dataSource.getRepository(Patient);
    const patient = repository.create({
      intakeStatus: 'submitted',
      origin: 'legacy',
      fullName: 'Awaiting Evaluation',
      email: freshEmail(),
      dateOfBirth: yearsAgo(41),
      accountStatus: 'prospect',
      createdAt: now,
      submittedAt: now,
      updatedAt: now,
    });

    await repository.insert(patient);

    return patient.id;
  }

  /** One patient resting in each of the eight statuses (2.2), by status. The draft is made first, so it is also the oldest row. */
  async function patientInEveryStatus(): Promise<Record<IntakeStatus, string>> {
    const { id: draft } = await createDraft();
    const { id: autoCleared } = await submitIntake();
    const { id: autoFlagged } = await submitIntake({
      glp1_current: true,
      glp1_medications: ['semaglutide'],
    });
    const { id: autoRejected } = await submitIntake({ date_of_birth: yearsAgo(10) });
    const inReview = await startedIntake();
    const approved = await decidedIntake('approved');
    const rejected = await decidedIntake('rejected');
    const submitted = await insertSubmittedPatient();

    return {
      draft,
      submitted,
      auto_cleared: autoCleared,
      auto_flagged: autoFlagged,
      auto_rejected: autoRejected,
      in_review: inReview,
      approved,
      rejected,
    };
  }

  // --- POST /intakes -------------------------------------------------------

  describe('POST /intakes', () => {
    it('creates a draft from step 1', async () => {
      const email = freshEmail();
      const response = await request(app.getHttpServer())
        .post('/intakes')
        .send({ full_name: 'Ada Lovelace', email, date_of_birth: yearsAgo(30) });

      expect(response.status).toBe(201);
      const view = response.body as IntakeView;
      expect(view.status).toBe('draft');
      expect(view.answers.full_name).toBe('Ada Lovelace');
      expect(view.answers.email).toBe(email);
    });

    it('422s an invalid step 1, naming the field', async () => {
      const response = await request(app.getHttpServer())
        .post('/intakes')
        .send({ full_name: 'A', email: 'not-an-email', date_of_birth: yearsAgo(30) });

      expect(response.status).toBe(422);
      const fields = (response.body.errors as { field: string }[]).map((e) => e.field);
      expect(fields).toContain('full_name');
      expect(fields).toContain('email');
    });

    it('two drafts may share an email', async () => {
      const email = freshEmail();

      const first = await request(app.getHttpServer())
        .post('/intakes')
        .send({ full_name: 'First Draft', email, date_of_birth: yearsAgo(30) });
      const second = await request(app.getHttpServer())
        .post('/intakes')
        .send({ full_name: 'Second Draft', email, date_of_birth: yearsAgo(30) });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect((first.body as IntakeView).id).not.toBe((second.body as IntakeView).id);
    });
  });

  // --- PATCH /intakes/:id ---------------------------------------------------

  describe('PATCH /intakes/:id', () => {
    it('saves a step and writes a consent_event granted on step 5', async () => {
      const { id, body } = await createDraft();
      await patchAllSteps(id, body);

      const events = await dataSource.query<{ action: string; type: string }[]>(
        `SELECT action, type FROM consent_event WHERE patient_id = ?`,
        [id],
      );

      expect(events).toEqual([{ action: 'granted', type: 'data_processing' }]);
    });

    it('422s that step alone on invalid fields', async () => {
      const { id } = await createDraft();

      const response = await request(app.getHttpServer())
        .patch(`/intakes/${id}`)
        .send({ step: 2, height_cm: 10, weight_kg: 70 });

      expect(response.status).toBe(422);
      expect((response.body.errors as { field: string }[]).map((e) => e.field)).toEqual([
        'height_cm',
      ]);
    });

    it('409s patching a submitted row', async () => {
      const { id, response: submitResponse } = await submitIntake();
      expect(submitResponse.status).toBe(200);

      const response = await request(app.getHttpServer())
        .patch(`/intakes/${id}`)
        .send({
          step: 1,
          full_name: 'Changed Name',
          email: freshEmail(),
          date_of_birth: yearsAgo(30),
        });

      expect(response.status).toBe(409);
    });

    it('409s a step with no draft at that id', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/intakes/00000000-0000-0000-0000-000000000000`)
        .send({ step: 1, full_name: 'Nobody', email: freshEmail(), date_of_birth: yearsAgo(30) });

      expect(response.status).toBe(409);
    });
  });

  // --- POST /intakes/:id/submit ---------------------------------------------

  describe('POST /intakes/:id/submit', () => {
    it('stores the evaluation and writes draft->submitted and submitted->auto_* audit events', async () => {
      const { id, response } = await submitIntake();

      expect(response.status).toBe(200);
      expect((response.body as IntakeView).status).toBe('received');

      const detail = await request(app.getHttpServer()).get(`/review/intakes/${id}`);
      expect(detail.status).toBe(200);
      const body = detail.body as ReviewDetail;

      expect(body.evaluation.rulesetVersion).toBe('elig-1');
      expect(body.evaluation.results).toHaveLength(6);
      // BMI 34.6, glp1/thyroid/pancreatitis all "no", consent granted -> nothing matches.
      expect(body.status).toBe('auto_cleared');

      const events = await auditEventsFor(id);
      expect(events.map((e) => [e.action, e.fromState, e.toState, e.actor])).toEqual([
        ['create', null, 'draft', 'patient'],
        ['transition', 'draft', 'submitted', 'patient'],
        ['transition', 'submitted', 'auto_cleared', 'system'],
      ]);
    });

    it('409s submitting a row that is not a draft', async () => {
      const { id } = await submitIntake();

      const response = await request(app.getHttpServer()).post(`/intakes/${id}/submit`);

      expect(response.status).toBe(409);
    });

    it('422s an incomplete submission, naming every missing field', async () => {
      const { id } = await createDraft();
      // Only step 1 was ever saved.

      const response = await request(app.getHttpServer()).post(`/intakes/${id}/submit`);

      expect(response.status).toBe(422);
      expect((response.body.errors as unknown[]).length).toBeGreaterThan(1);
    });

    it('409s with a field error on email, writing nothing, when a non-draft patient already holds it', async () => {
      const email = freshEmail();
      const { response: firstSubmit } = await submitIntake({ email });
      expect(firstSubmit.status).toBe(200);

      const secondDraft = await createDraft({ email });
      await patchAllSteps(secondDraft.id, secondDraft.body);

      const response = await request(app.getHttpServer()).post(`/intakes/${secondDraft.id}/submit`);

      expect(response.status).toBe(409);
      expect(response.body.errors).toEqual([expect.objectContaining({ field: 'email' })]);

      // Nothing written: the second draft is still a draft.
      const view = await request(app.getHttpServer()).get(`/intakes/${secondDraft.id}`);
      expect((view.body as IntakeView).status).toBe('draft');
    });

    it('404s GET for an id naming no intake', async () => {
      const response = await request(app.getHttpServer()).get(
        `/intakes/00000000-0000-0000-0000-000000000000`,
      );

      expect(response.status).toBe(404);
    });
  });

  // --- GET /review/intakes ---------------------------------------------------

  describe('GET /review/intakes', () => {
    it('defaults to auto_flagged, auto_cleared and in_review, excluding auto_rejected', async () => {
      const { id: clearedId } = await submitIntake();
      const { id: flaggedId } = await submitIntake({
        glp1_current: true,
        glp1_medications: ['semaglutide'],
      });
      const { id: rejectedId } = await submitIntake({ date_of_birth: yearsAgo(10) });

      const inReviewStart = await submitIntake();
      const startResponse = await request(app.getHttpServer())
        .post(`/review/intakes/${inReviewStart.id}/start`)
        .send({ actor: 'Dr. Okafor' });
      expect(startResponse.status).toBe(200);

      const response = await request(app.getHttpServer()).get('/review/intakes');
      expect(response.status).toBe(200);

      const ids = (response.body as ReviewQueueEntry[]).map((entry) => entry.id);
      expect(ids).toContain(clearedId);
      expect(ids).toContain(flaggedId);
      expect(ids).toContain(inReviewStart.id);
      expect(ids).not.toContain(rejectedId);

      const rejectedOnly = await request(app.getHttpServer())
        .get('/review/intakes')
        .query({ status: 'auto_rejected' });
      expect((rejectedOnly.body as ReviewQueueEntry[]).map((e) => e.id)).toEqual([rejectedId]);
    });

    it('finds the patient in every one of the eight statuses', async () => {
      const ids = await patientInEveryStatus();

      for (const status of INTAKE_STATUSES) {
        const response = await request(app.getHttpServer())
          .get('/review/intakes')
          .query({ status });

        expect(response.status).toBe(200);
        expect((response.body as ReviewQueueEntry[]).map((entry) => entry.id)).toEqual([
          ids[status],
        ]);
      }
    });

    it('still defaults to those three alone, with all eight in the table', async () => {
      const ids = await patientInEveryStatus();

      const response = await request(app.getHttpServer()).get('/review/intakes');
      expect(response.status).toBe(200);

      expect((response.body as ReviewQueueEntry[]).map((entry) => entry.id).sort()).toEqual(
        [ids.auto_flagged, ids.auto_cleared, ids.in_review].sort(),
      );
    });

    it('builds a row for a draft and for a decided patient', async () => {
      const ids = await patientInEveryStatus();

      const response = await request(app.getHttpServer())
        .get('/review/intakes')
        .query({ status: 'draft,approved' });
      expect(response.status).toBe(200);

      const rows = response.body as ReviewQueueEntry[];
      const draft = rows.find((row) => row.id === ids.draft);
      const approved = rows.find((row) => row.id === ids.approved);

      // A draft answered step 1 and no more: no submission date, no BMI, and
      // an age read as of today rather than a nonsense number off a null.
      // The name is the first column (2.4): a line has to read as a person,
      // not as a uuid nobody can recognise.
      expect(draft).toMatchObject({
        name: 'Ada Lovelace',
        submittedAt: null,
        bmi: null,
        age: 30,
        matchedRuleIds: [],
      });

      expect(approved?.submittedAt).not.toBeNull();
      expect(approved?.age).toBe(30);
      expect(approved?.bmi).toBeGreaterThan(0);
    });

    it('400s an unrecognised status, but not a decided one', async () => {
      const ids = await patientInEveryStatus();

      const nonsense = await request(app.getHttpServer())
        .get('/review/intakes')
        .query({ status: 'nonsense' });
      expect(nonsense.status).toBe(400);

      // `approved` and `rejected` were a 400 here too, once: deciding a
      // patient took it off every list there was.
      const decided = await request(app.getHttpServer())
        .get('/review/intakes')
        .query({ status: 'approved,rejected' });
      expect(decided.status).toBe(200);
      expect((decided.body as ReviewQueueEntry[]).map((entry) => entry.id).sort()).toEqual(
        [ids.approved, ids.rejected].sort(),
      );
    });

    it('filters by origin', async () => {
      const { id: intakeId } = await submitIntake();
      const legacyPatientId = await importLegacyPatient();

      // Every queue status: the legacy row's own landing status (auto_flagged
      // or auto_rejected) is irrelevant here — this asserts origin, not status.
      const everyStatus = QUEUE_STATUSES.join(',');

      const intakeOnly = await request(app.getHttpServer())
        .get('/review/intakes')
        .query({ origin: 'intake', status: everyStatus });
      expect(intakeOnly.status).toBe(200);
      const intakeIds = (intakeOnly.body as ReviewQueueEntry[]).map((e) => e.id);
      expect(intakeIds).toContain(intakeId);
      expect(intakeIds).not.toContain(legacyPatientId);
      expect((intakeOnly.body as ReviewQueueEntry[]).every((e) => e.origin === 'intake')).toBe(
        true,
      );

      const legacyOnly = await request(app.getHttpServer())
        .get('/review/intakes')
        .query({ origin: 'legacy', status: everyStatus });
      expect(legacyOnly.status).toBe(200);
      const legacyIds = (legacyOnly.body as ReviewQueueEntry[]).map((e) => e.id);
      expect(legacyIds).toContain(legacyPatientId);
      expect(legacyIds).not.toContain(intakeId);
      expect((legacyOnly.body as ReviewQueueEntry[]).every((e) => e.origin === 'legacy')).toBe(
        true,
      );
    });

    it('400s an unrecognised origin', async () => {
      const response = await request(app.getHttpServer())
        .get('/review/intakes')
        .query({ origin: 'nonsense' });

      expect(response.status).toBe(400);
    });

    it('sorts oldest submission first', async () => {
      const { id: first } = await submitIntake();
      const { id: second } = await submitIntake();

      const response = await request(app.getHttpServer()).get('/review/intakes');
      const ids = (response.body as ReviewQueueEntry[]).map((e) => e.id);

      expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));
    });

    it('sorts a draft by its creation date, not to either end of the line', async () => {
      const { id: before } = await submitIntake();
      const { id: draft } = await createDraft();
      const { id: after } = await submitIntake();

      // Stamped rather than raced: three rows an hour apart on the one line
      // the queue sorts on, whatever the clock did while the test ran. Only
      // `intake_status` is trigger-guarded, so these columns take an UPDATE.
      await dataSource.query(`UPDATE patient SET submitted_at = ? WHERE id = ?`, [
        '2026-01-01T09:00:00.000Z',
        before,
      ]);
      await dataSource.query(`UPDATE patient SET created_at = ? WHERE id = ?`, [
        '2026-01-01T10:00:00.000Z',
        draft,
      ]);
      await dataSource.query(`UPDATE patient SET submitted_at = ? WHERE id = ?`, [
        '2026-01-01T11:00:00.000Z',
        after,
      ]);

      const response = await request(app.getHttpServer())
        .get('/review/intakes')
        .query({ status: 'draft,auto_cleared' });
      expect(response.status).toBe(200);

      // Not first, which is where a null sort key would have put it.
      expect((response.body as ReviewQueueEntry[]).map((entry) => entry.id)).toEqual([
        before,
        draft,
        after,
      ]);
    });

    it('orders a draft by its creation date, the same way twice', async () => {
      const ids = await patientInEveryStatus();
      const everyStatus = QUEUE_STATUSES.join(',');

      const load = async (): Promise<string[]> => {
        const response = await request(app.getHttpServer())
          .get('/review/intakes')
          .query({ status: everyStatus });
        expect(response.status).toBe(200);
        return (response.body as ReviewQueueEntry[]).map((entry) => entry.id);
      };

      const first = await load();
      const second = await load();

      expect(first).toHaveLength(8);
      // The draft was made before any of the others, and having no submission
      // date does not move it to either end.
      expect(first[0]).toBe(ids.draft);
      expect(second).toEqual(first);
    });
  });

  // --- POST /review/intakes/:id/start and /decide ----------------------------

  describe('start and decide', () => {
    it('starts review on an auto_* row, actor recorded', async () => {
      const { id } = await submitIntake();

      const response = await request(app.getHttpServer())
        .post(`/review/intakes/${id}/start`)
        .send({ actor: 'Dr. Okafor' });

      expect(response.status).toBe(200);

      const events = await auditEventsFor(id);
      const last = events[events.length - 1];
      expect(last).toMatchObject({
        action: 'transition',
        toState: 'in_review',
        actor: 'Dr. Okafor',
      });
    });

    it('409s starting a row that is not auto_*', async () => {
      const { id } = await createDraft();

      const response = await request(app.getHttpServer())
        .post(`/review/intakes/${id}/start`)
        .send({ actor: 'Dr. Okafor' });

      expect(response.status).toBe(409);
    });

    it('409s starting an id naming no patient at all', async () => {
      const response = await request(app.getHttpServer())
        .post(`/review/intakes/00000000-0000-0000-0000-000000000000/start`)
        .send({ actor: 'Dr. Okafor' });

      expect(response.status).toBe(409);
    });

    it('422s deciding without a note', async () => {
      const { id } = await submitIntake();
      await request(app.getHttpServer())
        .post(`/review/intakes/${id}/start`)
        .send({ actor: 'Dr. Okafor' });

      const missing = await request(app.getHttpServer())
        .post(`/review/intakes/${id}/decide`)
        .send({ decision: 'approved', actor: 'Dr. Okafor' });
      expect(missing.status).toBe(422);

      const blank = await request(app.getHttpServer())
        .post(`/review/intakes/${id}/decide`)
        .send({ decision: 'approved', note: '   ', actor: 'Dr. Okafor' });
      expect(blank.status).toBe(422);
    });

    it('approves with a note, writing the decision audit event with that reason', async () => {
      const { id } = await submitIntake();
      await request(app.getHttpServer())
        .post(`/review/intakes/${id}/start`)
        .send({ actor: 'Dr. Okafor' });

      const response = await request(app.getHttpServer())
        .post(`/review/intakes/${id}/decide`)
        .send({ decision: 'approved', note: '  meets every criterion  ', actor: 'Dr. Okafor' });

      expect(response.status).toBe(200);

      const events = await auditEventsFor(id);
      const last = events[events.length - 1];
      expect(last).toMatchObject({
        action: 'decision',
        toState: 'approved',
        actor: 'Dr. Okafor',
        reason: 'meets every criterion',
      });
    });

    it('409s deciding a row that is not in_review', async () => {
      const { id } = await submitIntake();

      const response = await request(app.getHttpServer())
        .post(`/review/intakes/${id}/decide`)
        .send({ decision: 'approved', note: 'looks fine', actor: 'Dr. Okafor' });

      expect(response.status).toBe(409);
    });
  });

  // --- GET /review/intakes/:id ------------------------------------------------

  describe('GET /review/intakes/:id', () => {
    it('groups answers by step and reports full status history', async () => {
      const { id } = await submitIntake();

      const response = await request(app.getHttpServer()).get(`/review/intakes/${id}`);
      expect(response.status).toBe(200);

      const body = response.body as ReviewDetail;
      expect(body.answers.step1.full_name.value).toBe('Ada Lovelace');
      expect(body.answers.step1.full_name.recorded).toBe(true);
      expect(body.answers.step5.consent_data_processing.value).toBe(true);
      expect(body.history.length).toBeGreaterThanOrEqual(2);
    });

    it('404s an id naming no patient', async () => {
      const response = await request(app.getHttpServer()).get(
        `/review/intakes/00000000-0000-0000-0000-000000000000`,
      );

      expect(response.status).toBe(404);
    });
  });
});
