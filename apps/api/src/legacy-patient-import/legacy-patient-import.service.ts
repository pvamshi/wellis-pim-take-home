import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, In, type EntityManager } from 'typeorm';
import { AuditWriter } from '../audit/audit-writer.service';
import {
  ConsentEvent,
  type ConsentEventAction,
  type ConsentEventType,
} from '../consent/consent-event.entity';
import type { EligibilityConsentEvent } from '../eligibility/eligibility-contract';
import { EligibilityService } from '../eligibility/eligibility.service';
import { Duplicate } from '../duplicates/duplicate.entity';
import { LegacyConsent } from '../legacy/legacy-consent.entity';
import { LegacyIntake } from '../legacy/legacy-intake.entity';
import { LegacyPatient } from '../legacy/legacy-patient.entity';
import { LegacyConsentRule, LegacyPatientRule } from '../legacy/legacy-rule.entity';
import { IntakeStateMachine } from '../patient/intake-state-machine.service';
import type { IntakeStatus } from '../patient/intake-status';
import { Patient, type AccountStatus, type Sex } from '../patient/patient.entity';
import { fieldError, type FieldError } from '../patient/validation/field-error';
import { normalizeEmail, normalizeFullName } from '../patient/validation/field-validators';
import { validateLegacyImportPatient } from '../patient/validation/legacy-import-validators';
import { RowRejection } from '../rows/row-rejection.entity';

export interface ImportedRow {
  readonly outcome: 'imported';
  readonly patientId: string;
  readonly intakeStatus: IntakeStatus;
}

export interface InvalidRow {
  readonly outcome: 'invalid';
  readonly errors: FieldError[];
}

/** A precondition (2.6) the row failed, before anything was read or written for it. */
export interface PreconditionFailedRow {
  readonly outcome: 'precondition-failed';
  readonly reason: string;
}

export type LegacyPatientImportOutcome = ImportedRow | InvalidRow | PreconditionFailedRow;

/** One row of `POST /rows/import`'s response (2.9, 2.6's "Response per row"). */
export type BulkImportRowResult =
  | {
      readonly legacyId: string;
      readonly imported: true;
      readonly patientId: string;
      readonly intakeStatus: IntakeStatus;
    }
  | { readonly legacyId: string; readonly imported: false; readonly errors: FieldError[] };

/**
 * A raw legacy number field, parsed for validation (2.5's `height_cm`/`weight_kg`
 * rules expect an actual `number`, but `legacy_patient` stores everything as
 * text). `null` for missing (empty/absent — "may be null", 2.5); the ORIGINAL
 * string for anything that does not parse to a finite number, so
 * `validateHeightCm`/`validateWeightKg`'s `typeof value !== 'number'` check
 * fails it as "must be a number" instead of silently comparing `NaN` against a
 * range (where every `<`/`>` is false and a garbage value would pass).
 */
function parseLegacyDecimal(raw: string | null): number | string | null {
  if (raw === null) {
    return null;
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const parsed = Number(trimmed);

  return Number.isFinite(parsed) ? parsed : raw;
}

/** The legacy patient row, mapped into `validateLegacyImportPatient`'s own field names (2.5, 2.6's mapping table) — before anything is normalised or stored. */
function mapToImportBody(legacyPatient: LegacyPatient): Record<string, unknown> {
  return {
    full_name: legacyPatient.fullName,
    email: legacyPatient.email,
    date_of_birth: legacyPatient.dob,
    height_cm: parseLegacyDecimal(legacyPatient.heightCm),
    weight_kg: parseLegacyDecimal(legacyPatient.weight),
    weight_unit: legacyPatient.weightUnit,
    sex: legacyPatient.sex,
    bsn: legacyPatient.bsn,
    phone: legacyPatient.phone,
    account_status: legacyPatient.status,
    signup_date: legacyPatient.signupDate,
  };
}

/** `latest legacy intake … (2.6)`, by `submitted_at` — null when this legacy id has no intake row at all (intake rows "stay history", 2.6). */
function latestIntakeOf(rows: readonly LegacyIntake[]): LegacyIntake | null {
  if (rows.length === 0) {
    return null;
  }

  return rows.reduce((latest, row) =>
    (row.submittedAt ?? '') > (latest.submittedAt ?? '') ? row : latest,
  );
}

/**
 * One legacy `consent_event`'s own CHECK/NOT NULL constraints (2.1.2), ahead
 * of the insert that would otherwise fail on them — 2.6: "An event failing
 * 2.1.2's constraints fails the import with a field error naming that event."
 * `field` embeds the event's own row id so two bad events in one import are
 * two distinguishable errors, not one collapsed report.
 */
function validateLegacyConsentEvent(consent: LegacyConsent): FieldError[] {
  const errors: FieldError[] = [];
  const name = (column: string): string => `consent_event.${consent.id}.${column}`;

  if (consent.type !== 'data_processing') {
    errors.push(
      fieldError(name('type'), consent.type, 'consent event type must be "data_processing"'),
    );
  }

  if (consent.action !== 'granted' && consent.action !== 'revoked') {
    errors.push(
      fieldError(
        name('action'),
        consent.action,
        'consent event action must be "granted" or "revoked"',
      ),
    );
  }

  if (consent.version === null) {
    errors.push(fieldError(name('version'), consent.version, 'consent event version is required'));
  }

  if (consent.at === null) {
    errors.push(fieldError(name('at'), consent.at, 'consent event at is required'));
  }

  return errors;
}

/** `patient.email`/`patient.legacy_id`'s own unique constraints, translated to a field name — the belt behind an email/legacy_id race the precondition check already guards against in the ordinary case. */
function uniqueConstraintField(error: unknown): 'email' | 'legacy_id' | null {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('UNIQUE constraint failed: patient.email')) {
    return 'email';
  }

  if (message.includes('UNIQUE constraint failed: patient.legacy_id')) {
    return 'legacy_id';
  }

  return null;
}

/**
 * Individual and bulk legacy import (2.6, 2.9): a legacy patient promoted
 * into `patient` through the same flow an intake goes through (2.6:
 * "Import = a new patient entry through the same flow as an intake.").
 *
 * `importOne` is the whole per-row flow of 2.6 — preconditions, mapping,
 * validation, the patient row, its consent events, B2's evaluation, the two
 * audit events — in one transaction; `importMany` is 2.6's bulk shape, one
 * transaction per row so one bad row never blocks the rest. Every outcome is
 * a value (services throw no HTTP exceptions); the individual controller maps
 * `precondition-failed`/`invalid` to 409/422, and the bulk one folds both into
 * that row's `imported: false` entry, never a top-level HTTP error.
 */
@Injectable()
export class LegacyPatientImportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stateMachine: IntakeStateMachine,
    private readonly auditWriter: AuditWriter,
    private readonly eligibility: EligibilityService,
  ) {}

  /** One row, 2.6's preconditions through its audit events, in one transaction. */
  async importOne(legacyId: string, actor: string): Promise<LegacyPatientImportOutcome> {
    return await this.dataSource.transaction((manager) => this.runImport(manager, legacyId, actor));
  }

  /** Every row in `legacyIds`, each its own transaction (2.6: "one bad row never blocks the rest"). */
  async importMany(legacyIds: readonly string[], actor: string): Promise<BulkImportRowResult[]> {
    const results: BulkImportRowResult[] = [];

    for (const legacyId of legacyIds) {
      const outcome = await this.importOne(legacyId, actor);

      results.push(toBulkResult(legacyId, outcome));
    }

    return results;
  }

  private async runImport(
    manager: EntityManager,
    legacyId: string,
    actor: string,
  ): Promise<LegacyPatientImportOutcome> {
    const precondition = await this.checkPreconditions(manager, legacyId);

    if (!precondition.ok) {
      return { outcome: 'precondition-failed', reason: precondition.reason };
    }

    const legacyPatient = precondition.row;
    const body = mapToImportBody(legacyPatient);
    const fieldErrors = validateLegacyImportPatient(body);

    if (fieldErrors.length > 0) {
      return { outcome: 'invalid', errors: fieldErrors };
    }

    const latestIntake = latestIntakeOf(
      await manager.getRepository(LegacyIntake).find({ where: { legacyPatientId: legacyId } }),
    );

    const consentRows = await manager
      .getRepository(LegacyConsent)
      .find({ where: { legacyPatientId: legacyId } });
    const skippedConsentRowIds = await this.confirmedDuplicateConsentRowIds(
      manager,
      consentRows.map((row) => row.id),
    );
    const consentToImport = consentRows.filter((row) => !skippedConsentRowIds.has(row.id));

    const consentErrors = consentToImport.flatMap((row) => validateLegacyConsentEvent(row));

    if (consentErrors.length > 0) {
      return { outcome: 'invalid', errors: consentErrors };
    }

    const now = new Date().toISOString();
    const patientId = randomUUID();
    const heightCm = (body.height_cm as number | null | undefined) ?? null;
    const weightKg = (body.weight_kg as number | null | undefined) ?? null;

    const inserted = await this.insertPatient(manager, {
      id: patientId,
      fullName: normalizeFullName(body.full_name as string),
      email: normalizeEmail(body.email as string),
      dateOfBirth: body.date_of_birth as string,
      heightCm,
      weightKg,
      sex: (body.sex as Sex | null | undefined) ?? null,
      bsn: (body.bsn as string | null | undefined) ?? null,
      phone: (body.phone as string | null | undefined) ?? null,
      city: legacyPatient.city,
      accountStatus: body.account_status as AccountStatus,
      signupDate: (body.signup_date as string | null | undefined) ?? null,
      acquisitionSource:
        legacyPatient.source === null ? null : legacyPatient.source.trim().toLowerCase(),
      otherMedications: latestIntake?.medsCurrent ?? null,
      otherConditions: latestIntake?.conditions ?? null,
      legacyId,
      now,
    });

    if (inserted.outcome === 'invalid') {
      return inserted;
    }

    await this.auditWriter.write(manager, {
      entity: 'patient',
      entityId: patientId,
      action: 'import',
      fromState: null,
      toState: 'submitted',
      actor,
      at: now,
    });

    const eligibilityEvents: EligibilityConsentEvent[] = [];

    for (const consent of consentToImport) {
      const type = consent.type as ConsentEventType;
      const action = consent.action as ConsentEventAction;
      const at = consent.at as string;

      await manager.insert(ConsentEvent, {
        id: randomUUID(),
        patientId,
        type,
        action,
        version: consent.version as string,
        at,
        origin: 'legacy',
        legacyRowId: consent.id,
      });

      eligibilityEvents.push({ type, action, at });
    }

    const evaluation = this.eligibility.evaluate(
      {
        dateOfBirth: body.date_of_birth as string,
        heightCm,
        weightKg,
        // Free text is never parsed into answers (2.6, I26/I29): these four
        // stay null for every legacy import, whatever the source held.
        glp1Current: null,
        glp1Medications: null,
        weightConditions: null,
        thyroidCancerHistory: null,
        pancreatitisHistory: null,
        consentEvents: eligibilityEvents,
      },
      new Date(),
    );

    await manager.update(
      Patient,
      { id: patientId },
      {
        bmi: evaluation.bmi,
        rulesetVersion: evaluation.rulesetVersion,
        evaluation: [...evaluation.results],
      },
    );

    const transitioned = await this.stateMachine.transition(
      { id: patientId, from: 'submitted', to: evaluation.outcome, actor: 'system' },
      manager,
    );

    if (transitioned.outcome === 'conflict') {
      // This row was inserted moments ago, in this same transaction — nothing
      // else could have moved it off `submitted` already.
      throw new Error(`unexpected conflict evaluating freshly-imported patient "${patientId}"`);
    }

    return { outcome: 'imported', patientId, intakeStatus: transitioned.patient.intakeStatus };
  }

  /**
   * 2.6's five preconditions, in an order that resolves the one physical row
   * first (`row`), since everything after needs its `id`. Short-circuits on
   * the first failure — 2.6 reports one reason per row, not every one at once.
   */
  private async checkPreconditions(
    manager: EntityManager,
    legacyId: string,
  ): Promise<{ ok: true; row: LegacyPatient } | { ok: false; reason: string }> {
    const rows = await manager
      .getRepository(LegacyPatient)
      .find({ where: { legacyPatientId: legacyId } });

    if (rows.length === 0) {
      return { ok: false, reason: `no legacy patient row is named "${legacyId}"` };
    }

    if (rows.length > 1) {
      return {
        ok: false,
        reason: `"${legacyId}" names ${rows.length} legacy patient rows, not exactly one`,
      };
    }

    const row = rows[0];

    const alreadyImported = await manager.getRepository(Patient).findOneBy({ legacyId });

    if (alreadyImported !== null) {
      return { ok: false, reason: `legacy patient "${legacyId}" is already imported` };
    }

    const rejected = await manager
      .getRepository(RowRejection)
      .findOneBy({ table: 'patient', legacyId });

    if (rejected !== null) {
      return { ok: false, reason: `legacy patient "${legacyId}" is Import rejected` };
    }

    const pendingPatientFinding = await manager
      .getRepository(LegacyPatientRule)
      .findOneBy({ legacyId, status: 'pending' });

    if (pendingPatientFinding !== null) {
      return { ok: false, reason: `legacy patient "${legacyId}" has a pending finding` };
    }

    const pendingConsentFinding = await manager
      .getRepository(LegacyConsentRule)
      .findOneBy({ legacyId, status: 'pending' });

    if (pendingConsentFinding !== null) {
      return {
        ok: false,
        reason: `the consent row for legacy patient "${legacyId}" has a pending finding`,
      };
    }

    const pendingLink = await manager.getRepository(Duplicate).findOne({
      where: [
        { sourceTable: 'patient', status: 'pending', duplicateRowId: row.id },
        { sourceTable: 'patient', status: 'pending', canonicalRowId: row.id },
      ],
    });

    if (pendingLink !== null) {
      return { ok: false, reason: `legacy patient "${legacyId}" has a pending duplicate link` };
    }

    return { ok: true, row };
  }

  /** Which legacy consent rows (by their own generated id) are the X side of a *confirmed* duplicate link (2.6, 1.7.5: "acceptance skips the confirmed duplicate data row"). */
  private async confirmedDuplicateConsentRowIds(
    manager: EntityManager,
    consentRowIds: readonly string[],
  ): Promise<Set<string>> {
    if (consentRowIds.length === 0) {
      return new Set();
    }

    const links = await manager.getRepository(Duplicate).find({
      where: {
        sourceTable: 'consent',
        status: 'confirmed',
        duplicateRowId: In([...consentRowIds]),
      },
    });

    return new Set(links.map((link) => link.duplicateRowId));
  }

  /**
   * The `patient` insert itself, with the one DB-level check no validator
   * catches: email uniqueness among non-draft rows (2.1.1's partial index) —
   * caught and reported as a field error (2.6), never a 500. A `legacy_id`
   * collision is the same belt for the same reason, though the precondition
   * check above already refuses that case in the ordinary, non-racing path.
   */
  private async insertPatient(
    manager: EntityManager,
    fields: {
      readonly id: string;
      readonly fullName: string;
      readonly email: string;
      readonly dateOfBirth: string;
      readonly heightCm: number | null;
      readonly weightKg: number | null;
      readonly sex: Sex | null;
      readonly bsn: string | null;
      readonly phone: string | null;
      readonly city: string | null;
      readonly accountStatus: AccountStatus;
      readonly signupDate: string | null;
      readonly acquisitionSource: string | null;
      readonly otherMedications: string | null;
      readonly otherConditions: string | null;
      readonly legacyId: string;
      readonly now: string;
    },
  ): Promise<{ outcome: 'ok' } | InvalidRow> {
    try {
      await manager.insert(Patient, {
        id: fields.id,
        intakeStatus: 'submitted',
        origin: 'legacy',
        fullName: fields.fullName,
        email: fields.email,
        dateOfBirth: fields.dateOfBirth,
        heightCm: fields.heightCm,
        weightKg: fields.weightKg,
        glp1Current: null,
        glp1Medications: null,
        otherMedications: fields.otherMedications,
        weightConditions: null,
        thyroidCancerHistory: null,
        pancreatitisHistory: null,
        otherConditions: fields.otherConditions,
        alcoholUnitsWeek: null,
        questionnaireVersion: null,
        sex: fields.sex,
        bsn: fields.bsn,
        phone: fields.phone,
        city: fields.city,
        accountStatus: fields.accountStatus,
        signupDate: fields.signupDate,
        acquisitionSource: fields.acquisitionSource,
        legacyId: fields.legacyId,
        createdAt: fields.now,
        submittedAt: fields.now,
        updatedAt: fields.now,
      });

      return { outcome: 'ok' };
    } catch (error) {
      const field = uniqueConstraintField(error);

      if (field === 'email') {
        return {
          outcome: 'invalid',
          errors: [fieldError('email', fields.email, 'email is already in use')],
        };
      }

      if (field === 'legacy_id') {
        return {
          outcome: 'invalid',
          errors: [fieldError('legacy_id', fields.legacyId, 'legacy_id is already imported')],
        };
      }

      throw error;
    }
  }
}

function toBulkResult(legacyId: string, outcome: LegacyPatientImportOutcome): BulkImportRowResult {
  if (outcome.outcome === 'imported') {
    return {
      legacyId,
      imported: true,
      patientId: outcome.patientId,
      intakeStatus: outcome.intakeStatus,
    };
  }

  if (outcome.outcome === 'invalid') {
    return { legacyId, imported: false, errors: outcome.errors };
  }

  return { legacyId, imported: false, errors: [fieldError(null, null, outcome.reason)] };
}
