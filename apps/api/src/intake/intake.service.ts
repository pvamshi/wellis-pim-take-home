import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { AuditWriter } from '../audit/audit-writer.service';
import { ConsentEvent } from '../consent/consent-event.entity';
import { ConsentEventsService } from '../consent/consent-events.service';
import { roundHalfUp } from '../eligibility/bmi';
import { EligibilityService } from '../eligibility/eligibility.service';
import { answersOf, type PatientAnswers } from '../patient/patient-answers';
import { IntakeStateMachine } from '../patient/intake-state-machine.service';
import { Patient } from '../patient/patient.entity';
import { fieldError, type FieldError } from '../patient/validation/field-error';
import { normalizeEmail, normalizeFullName } from '../patient/validation/field-validators';
import {
  validateFullIntakeSubmission,
  validateIntakeStep,
  type IntakeStep,
} from '../patient/validation/intake-validators';

/** `q2026.1` (2.3.1) — distinct from legacy's own `v1`/`v2` labels so a stored label is never mistaken for one. */
export const QUESTIONNAIRE_VERSION = 'q2026.1';

/** `dp-2026.1` (2.3.1) — the consent text's version, stored on every `consent_event` step 5 writes. */
export const CONSENT_VERSION = 'dp-2026.1';

/**
 * What the patient reads back (2.3, 2.9): never the outcome, never a BMI,
 * only whether the draft is still open or has moved past their hands. Every
 * `intake_status` from `submitted` on collapses into `received` — the queue's
 * own vocabulary belongs to the review screen (2.4), not to this one.
 */
export type IntakePatientStatus = 'draft' | 'received';

export interface IntakeView {
  readonly id: string;
  readonly status: IntakePatientStatus;
  readonly answers: PatientAnswers;
}

export type IntakeCreateOutcome =
  | { readonly outcome: 'created'; readonly view: IntakeView }
  | { readonly outcome: 'invalid'; readonly errors: FieldError[] };

export type IntakePatchOutcome =
  | { readonly outcome: 'saved'; readonly view: IntakeView }
  | { readonly outcome: 'invalid'; readonly errors: FieldError[] }
  /** No draft at this id — nonexistent or already past `draft` (2.9: "409 not draft"), one outcome either way. */
  | { readonly outcome: 'not-draft' };

export type IntakeSubmitOutcome =
  | { readonly outcome: 'submitted'; readonly view: IntakeView }
  | { readonly outcome: 'invalid'; readonly errors: FieldError[] }
  | { readonly outcome: 'not-draft' }
  | { readonly outcome: 'email-taken'; readonly errors: FieldError[] };

function patientStatus(status: Patient['intakeStatus']): IntakePatientStatus {
  return status === 'draft' ? 'draft' : 'received';
}

/**
 * The intake form's write path (2.3, 2.9): `POST /intakes`, `PATCH
 * /intakes/:id`, `POST /intakes/:id/submit`, `GET /intakes/:id` — using B1's
 * state machine and B2's validators and engine, exactly as the task names them.
 *
 * Every write is one transaction; every outcome is a value, never a thrown
 * HTTP exception (services throw none) — the controller maps `not-draft` to
 * 409, `invalid`/`email-taken` to 422, and everything else to 200/201.
 */
@Injectable()
export class IntakeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stateMachine: IntakeStateMachine,
    private readonly auditWriter: AuditWriter,
    private readonly eligibility: EligibilityService,
    private readonly consentEvents: ConsentEventsService,
  ) {}

  /** Step 1 saved (2.3): a new `draft` patient row, `create` audited, actor `patient`. */
  async create(body: unknown): Promise<IntakeCreateOutcome> {
    const errors = validateIntakeStep(1, body);

    if (errors.length > 0) {
      return { outcome: 'invalid', errors };
    }

    const record = body as Record<string, unknown>;
    const id = randomUUID();
    const now = new Date().toISOString();

    return await this.dataSource.transaction(async (manager) => {
      await manager.insert(Patient, {
        id,
        intakeStatus: 'draft',
        origin: 'intake',
        fullName: normalizeFullName(record.full_name as string),
        email: normalizeEmail(record.email as string),
        dateOfBirth: record.date_of_birth as string,
        accountStatus: 'prospect',
        questionnaireVersion: QUESTIONNAIRE_VERSION,
        createdAt: now,
        updatedAt: now,
      });

      await this.auditWriter.write(manager, {
        entity: 'patient',
        entityId: id,
        action: 'create',
        fromState: null,
        toState: 'draft',
        actor: 'patient',
        at: now,
      });

      const patient = await manager.findOneByOrFail(Patient, { id });

      return { outcome: 'created', view: this.viewOf(patient, []) };
    });
  }

  /** One step saved (2.3, 2.5): re-validates that step's fields, 409 if the row is not a draft. */
  async patch(id: string, step: IntakeStep, body: unknown): Promise<IntakePatchOutcome> {
    const errors = validateIntakeStep(step, body);

    if (errors.length > 0) {
      return { outcome: 'invalid', errors };
    }

    const record = body as Record<string, unknown>;

    return await this.dataSource.transaction(async (manager) => {
      const patient = await manager.findOneBy(Patient, { id });

      if (patient === null || patient.intakeStatus !== 'draft') {
        return { outcome: 'not-draft' };
      }

      const now = new Date().toISOString();

      await this.writeStep(manager, id, step, record, now);
      await manager.update(Patient, { id }, { updatedAt: now });

      const updated = await manager.findOneByOrFail(Patient, { id });
      const events = await this.consentEvents.listFor(id, manager);

      return { outcome: 'saved', view: this.viewOf(updated, events) };
    });
  }

  /**
   * Validate all, `submitted` → `auto_*`, in one transaction (2.9). The email
   * check runs only here (2.3), against every non-draft row but this one, and
   * the evaluation is stored alongside the second transition.
   */
  async submit(id: string): Promise<IntakeSubmitOutcome> {
    return await this.dataSource.transaction(async (manager) => {
      const patient = await manager.findOneBy(Patient, { id });

      if (patient === null || patient.intakeStatus !== 'draft') {
        return { outcome: 'not-draft' };
      }

      const events = await this.consentEvents.listFor(id, manager);
      const consentGranted = this.consentEvents.hasGrantedDataProcessing(events);
      const answers = answersOf(patient, consentGranted);
      const errors = validateFullIntakeSubmission(answers);

      if (errors.length > 0) {
        return { outcome: 'invalid', errors };
      }

      const emailHolder = await manager
        .getRepository(Patient)
        .createQueryBuilder('p')
        .where('p.email = :email', { email: patient.email })
        .andWhere("p.intake_status <> 'draft'")
        .andWhere('p.id <> :id', { id })
        .getOne();

      if (emailHolder !== null) {
        return {
          outcome: 'email-taken',
          errors: [fieldError('email', patient.email, 'email is already in use')],
        };
      }

      const asOf = new Date();
      const evaluation = this.eligibility.evaluate(
        {
          dateOfBirth: patient.dateOfBirth,
          heightCm: patient.heightCm,
          weightKg: patient.weightKg,
          glp1Current: patient.glp1Current,
          glp1Medications: patient.glp1Medications,
          weightConditions: patient.weightConditions,
          thyroidCancerHistory: patient.thyroidCancerHistory,
          pancreatitisHistory: patient.pancreatitisHistory,
          consentEvents: this.consentEvents.toEligibilityEvents(events),
        },
        asOf,
      );

      const submitted = await this.stateMachine.transition(
        { id, from: 'draft', to: 'submitted', actor: 'patient' },
        manager,
      );

      if (submitted.outcome === 'conflict') {
        return { outcome: 'not-draft' };
      }

      await manager.update(
        Patient,
        { id },
        {
          bmi: evaluation.bmi,
          rulesetVersion: evaluation.rulesetVersion,
          evaluation: [...evaluation.results],
        },
      );

      const evaluated = await this.stateMachine.transition(
        { id, from: 'submitted', to: evaluation.outcome, actor: 'system' },
        manager,
      );

      if (evaluated.outcome === 'conflict') {
        // draft -> submitted just landed in this same transaction, so nothing
        // else could have moved the row off `submitted` in between.
        throw new Error(`unexpected conflict evaluating freshly-submitted intake "${id}"`);
      }

      return { outcome: 'submitted', view: this.viewOf(evaluated.patient, events) };
    });
  }

  /** The patient's own view (2.9): neutral status, no BMI, no outcome. Null when the id names no patient at all. */
  async get(id: string): Promise<IntakeView | null> {
    const patient = await this.dataSource.getRepository(Patient).findOneBy({ id });

    if (patient === null) {
      return null;
    }

    const events = await this.consentEvents.listFor(id);

    return this.viewOf(patient, events);
  }

  private async writeStep(
    manager: EntityManager,
    id: string,
    step: IntakeStep,
    record: Record<string, unknown>,
    now: string,
  ): Promise<void> {
    switch (step) {
      case 1:
        await manager.update(
          Patient,
          { id },
          {
            fullName: normalizeFullName(record.full_name as string),
            email: normalizeEmail(record.email as string),
            dateOfBirth: record.date_of_birth as string,
          },
        );
        return;
      case 2:
        await manager.update(
          Patient,
          { id },
          {
            heightCm: roundHalfUp(record.height_cm as number, 1),
            weightKg: roundHalfUp(record.weight_kg as number, 1),
          },
        );
        return;
      case 3:
        await manager.update(
          Patient,
          { id },
          {
            glp1Current: record.glp1_current as boolean,
            glp1Medications: (record.glp1_medications as string[] | undefined) ?? [],
            otherMedications: (record.other_medications as string | null | undefined) ?? null,
          },
        );
        return;
      case 4:
        await manager.update(
          Patient,
          { id },
          {
            weightConditions: record.weight_conditions as string[],
            thyroidCancerHistory: record.thyroid_cancer_history as boolean,
            pancreatitisHistory: record.pancreatitis_history as boolean,
            otherConditions: (record.other_conditions as string | null | undefined) ?? null,
            alcoholUnitsWeek: (record.alcohol_units_week as number | null | undefined) ?? null,
          },
        );
        return;
      case 5:
        // No patient column: step 5 is a consent_event, never a value on the row (2.3.1).
        await manager.insert(ConsentEvent, {
          id: randomUUID(),
          patientId: id,
          type: 'data_processing',
          action: 'granted',
          version: CONSENT_VERSION,
          at: now,
          origin: 'intake',
          legacyRowId: null,
        });
        return;
    }
  }

  private viewOf(patient: Patient, events: ConsentEvent[]): IntakeView {
    return {
      id: patient.id,
      status: patientStatus(patient.intakeStatus),
      answers: answersOf(patient, this.consentEvents.hasGrantedDataProcessing(events)),
    };
  }
}
