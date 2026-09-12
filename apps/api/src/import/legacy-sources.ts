import type { EntityTarget, ObjectLiteral } from 'typeorm';
import { LegacyConsent } from '../legacy/legacy-consent.entity';
import { LegacyIntake } from '../legacy/legacy-intake.entity';
import { LegacyPatient } from '../legacy/legacy-patient.entity';

/**
 * How a source file is read. The two shapes the export uses and nothing else.
 */
export type LegacySourceFormat = 'csv' | 'jsonl';

/**
 * One file of `legacy_export/`, described rather than coded.
 *
 * There is no logic here on purpose: the import does the same five things to
 * every source (read, map, resolve which ids exist, insert the rest, report),
 * so the only thing that differs between them is this descriptor. Adding a
 * fourth source is a new entry, not a new code path.
 */
export interface LegacySource {
  /** The file inside `legacy_export/`. */
  readonly file: string;
  readonly format: LegacySourceFormat;
  /** The table it lands in, used only for the report. */
  readonly table: string;
  readonly entity: EntityTarget<ObjectLiteral>;
  /**
   * The entity property holding the legacy id — `legacy_id` for patients,
   * `intake_id` for intakes, and the patient's id for consents, which is the
   * only identifier a consent event carries. Identity is this and nothing else
   * (1.0.2): values are never compared.
   */
  readonly legacyIdProperty: string;
  /**
   * Export column (or JSON key) -> entity property. Every key listed here must
   * be present in the parsed record or the import fails loudly — a column that
   * silently landed as null would make the reported counts worthless as a way
   * to validate a run (1.0.1).
   */
  readonly columns: Readonly<Record<string, string>>;
}

/**
 * Export order: patients, intakes, consents. The three tables have no foreign
 * keys between them (T1.1 deliberately created none), so the order buys nothing
 * but a readable report.
 */
export const legacySources: readonly LegacySource[] = [
  {
    file: 'patients.csv',
    format: 'csv',
    table: 'legacy_patient',
    entity: LegacyPatient,
    legacyIdProperty: 'legacyPatientId',
    columns: {
      legacy_id: 'legacyPatientId',
      full_name: 'fullName',
      email: 'email',
      dob: 'dob',
      sex: 'sex',
      bsn: 'bsn',
      phone: 'phone',
      city: 'city',
      weight: 'weight',
      weight_unit: 'weightUnit',
      height_cm: 'heightCm',
      status: 'status',
      signup_date: 'signupDate',
      source: 'source',
    },
  },
  {
    file: 'intakes.csv',
    format: 'csv',
    table: 'legacy_intake',
    entity: LegacyIntake,
    legacyIdProperty: 'legacyIntakeId',
    columns: {
      intake_id: 'legacyIntakeId',
      legacy_patient_id: 'legacyPatientId',
      submitted_at: 'submittedAt',
      questionnaire_version: 'questionnaireVersion',
      weight: 'weight',
      height: 'height',
      meds_current: 'medsCurrent',
      conditions: 'conditions',
      alcohol_units_week: 'alcoholUnitsWeek',
      outcome: 'outcome',
      reviewer_note: 'reviewerNote',
    },
  },
  {
    file: 'consents.jsonl',
    format: 'jsonl',
    table: 'legacy_consent',
    entity: LegacyConsent,
    legacyIdProperty: 'legacyPatientId',
    columns: {
      patient_legacy_id: 'legacyPatientId',
      type: 'type',
      action: 'action',
      at: 'at',
      version: 'version',
    },
  },
];
