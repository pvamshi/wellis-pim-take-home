import type { Patient } from './patient.entity';

/**
 * A patient row's questionnaire fields, keyed the way 2.3.1 and 2.5's
 * validators name them — the one shape B3's submit validation, B3's patient
 * view, and B4's review detail all read the same stored columns through.
 *
 * `consent_data_processing` has no column of its own on `patient` (2.3.1: step
 * 5 writes a `consent_event`, never a column) — every caller derives it from
 * that patient's consent history and hands it in here.
 */
export interface PatientAnswers {
  readonly full_name: string;
  readonly email: string;
  readonly date_of_birth: string;
  readonly height_cm: number | null;
  readonly weight_kg: number | null;
  readonly glp1_current: boolean | null;
  readonly glp1_medications: readonly string[] | null;
  readonly other_medications: string | null;
  readonly weight_conditions: readonly string[] | null;
  readonly thyroid_cancer_history: boolean | null;
  readonly pancreatitis_history: boolean | null;
  readonly other_conditions: string | null;
  readonly alcohol_units_week: number | null;
  readonly consent_data_processing: boolean;
}

/** `patient`'s own columns, reshaped into `PatientAnswers` — the inverse of what a PATCH writes back onto them. */
export function answersOf(patient: Patient, consentDataProcessing: boolean): PatientAnswers {
  return {
    full_name: patient.fullName,
    email: patient.email,
    date_of_birth: patient.dateOfBirth,
    height_cm: patient.heightCm,
    weight_kg: patient.weightKg,
    glp1_current: patient.glp1Current,
    glp1_medications: patient.glp1Medications,
    other_medications: patient.otherMedications,
    weight_conditions: patient.weightConditions,
    thyroid_cancer_history: patient.thyroidCancerHistory,
    pancreatitis_history: patient.pancreatitisHistory,
    other_conditions: patient.otherConditions,
    alcohol_units_week: patient.alcoholUnitsWeek,
    consent_data_processing: consentDataProcessing,
  };
}
