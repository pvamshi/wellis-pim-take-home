import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { INTAKE_STATUSES, type IntakeStatus, type PatientOrigin } from './intake-status';

/** `account_status` is commercial, from legacy — not `intake_status`, which is where intake and review put the row (2.1.1). */
export const ACCOUNT_STATUSES = ['active', 'paused', 'churned', 'prospect'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** P23's canonical two values. Null for a row sex was never asked or recorded on. */
export type Sex = 'M' | 'F';

/** The category a rule's own match belongs to (2.7) — never `'clear'`: clear is the absence of every rule's match, not a rule's own verdict. */
export type EvaluationOutcome = 'reject' | 'flag';

/** One rule's stored result (2.7): `patient.evaluation` is an array of these, one per `elig-1` rule, always six long. */
export interface EvaluationEntry {
  readonly ruleId: string;
  readonly matched: boolean;
  readonly outcome: EvaluationOutcome;
  readonly explanation: string;
}

/**
 * The main table (2.1.1): where an intake and an imported legacy patient both
 * live, from their first row onward. `origin` says which door a row came in
 * (not `source`, which is legacy's own acquisition-funnel column, kept below
 * as `acquisitionSource`); `intakeStatus` says where the row is in intake and
 * review, and is never touched directly — see `IntakeStateMachine`.
 *
 * Four `CHECK` constraints, exactly the four the column table marks: the 8
 * `intake_status` values, `origin`, `account_status`, and `sex`. Every other
 * constraint this table's own comment describes — 1 dp on `height_cm` etc.,
 * the calendar rules on `date_of_birth` — is a validator's job (2.5), not the
 * schema's: the schema stores what a validator already found acceptable.
 *
 * `uq_patient_email_non_draft` is the partial unique index 2.1.1 asks for:
 * one submitted patient per email, while drafts may share one freely (the
 * same shape `RuleVersion`'s "one active version" index already uses here).
 */
@Index('uq_patient_email_non_draft', ['email'], { unique: true, where: "intake_status <> 'draft'" })
@Check(`intake_status IN (${INTAKE_STATUSES.map((status) => `'${status}'`).join(', ')})`)
@Check(`origin IN ('intake', 'legacy')`)
@Check(`account_status IN ('active', 'paused', 'churned', 'prospect')`)
@Check(`sex IS NULL OR sex IN ('M', 'F')`)
@Entity('patient')
export class Patient {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'intake_status', type: 'text' })
  intakeStatus!: IntakeStatus;

  @Column({ name: 'origin', type: 'text' })
  origin!: PatientOrigin;

  @Column({ name: 'full_name', type: 'text' })
  fullName!: string;

  /** Stored lowercased (2.1.1) — the writer's job, not a column default SQLite has no clean way to express. */
  @Column({ name: 'email', type: 'text' })
  email!: string;

  /** `YYYY-MM-DD` (2.0 conventions). */
  @Column({ name: 'date_of_birth', type: 'text' })
  dateOfBirth!: string;

  @Column({ name: 'height_cm', type: 'real', nullable: true })
  heightCm!: number | null;

  @Column({ name: 'weight_kg', type: 'real', nullable: true })
  weightKg!: number | null;

  @Column({ name: 'bmi', type: 'real', nullable: true })
  bmi!: number | null;

  @Column({ name: 'glp1_current', type: 'boolean', nullable: true })
  glp1Current!: boolean | null;

  @Column({ name: 'glp1_medications', type: 'simple-json', nullable: true })
  glp1Medications!: string[] | null;

  @Column({ name: 'other_medications', type: 'text', nullable: true })
  otherMedications!: string | null;

  /** Null for legacy (2.1.1) — never asked on import (2.6). */
  @Column({ name: 'weight_conditions', type: 'simple-json', nullable: true })
  weightConditions!: string[] | null;

  @Column({ name: 'thyroid_cancer_history', type: 'boolean', nullable: true })
  thyroidCancerHistory!: boolean | null;

  @Column({ name: 'pancreatitis_history', type: 'boolean', nullable: true })
  pancreatitisHistory!: boolean | null;

  @Column({ name: 'other_conditions', type: 'text', nullable: true })
  otherConditions!: string | null;

  @Column({ name: 'alcohol_units_week', type: 'integer', nullable: true })
  alcoholUnitsWeek!: number | null;

  /** `q2026.1` (2.3.1). Null for legacy — a legacy row answered no questionnaire. */
  @Column({ name: 'questionnaire_version', type: 'text', nullable: true })
  questionnaireVersion!: string | null;

  /** Null until `EligibilityService.evaluate` runs (2.7); never re-evaluated once set. */
  @Column({ name: 'ruleset_version', type: 'text', nullable: true })
  rulesetVersion!: string | null;

  /** Every `elig-1` rule's result (2.7), stored once and never touched again. */
  @Column({ name: 'evaluation', type: 'simple-json', nullable: true })
  evaluation!: EvaluationEntry[] | null;

  @Column({ name: 'sex', type: 'text', nullable: true })
  sex!: Sex | null;

  /** Legacy only (2.1.1) — an intake never asks for it. */
  @Column({ name: 'bsn', type: 'text', nullable: true })
  bsn!: string | null;

  /** E.164. */
  @Column({ name: 'phone', type: 'text', nullable: true })
  phone!: string | null;

  @Column({ name: 'city', type: 'text', nullable: true })
  city!: string | null;

  /** Commercial status, from legacy `status`. An intake starts, and stays, `prospect` until Part C says otherwise. */
  @Column({ name: 'account_status', type: 'text' })
  accountStatus!: AccountStatus;

  @Column({ name: 'signup_date', type: 'text', nullable: true })
  signupDate!: string | null;

  /** Stored lowercased (2.1.1). From legacy `source` — the funnel, not `origin`. */
  @Column({ name: 'acquisition_source', type: 'text', nullable: true })
  acquisitionSource!: string | null;

  /** Set only on import (2.6); unique, so one legacy row is never imported twice. */
  @Index('uq_patient_legacy_id', { unique: true })
  @Column({ name: 'legacy_id', type: 'text', nullable: true })
  legacyId!: string | null;

  /** Set once, at insert. */
  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;

  /** Null until `draft` → `submitted` (2.2); set by `IntakeStateMachine.transition` alongside that UPDATE. */
  @Column({ name: 'submitted_at', type: 'text', nullable: true })
  submittedAt!: string | null;

  /** Null until `approved`/`rejected` (2.2); set by `IntakeStateMachine.transition` alongside that UPDATE. */
  @Column({ name: 'decided_at', type: 'text', nullable: true })
  decidedAt!: string | null;

  /** Touched by every `intake_status` transition and by every PATCH that saves a step. */
  @Column({ name: 'updated_at', type: 'text' })
  updatedAt!: string;
}
