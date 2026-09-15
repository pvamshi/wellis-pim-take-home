import type { FieldError } from './field-error';
import {
  validateAlcoholUnitsWeek,
  validateAnsweredYesNo,
  validateConsentChecked,
  validateDateOfBirth,
  validateEmail,
  validateFullName,
  validateGlp1Medications,
  validateHeightCm,
  validateOptionalText,
  validateWeightConditions,
  validateWeightKg,
} from './field-validators';

/** The intake form's six steps (2.3.1); step 6 is Check-and-submit and validates nothing of its own. */
export type IntakeStep = 1 | 2 | 3 | 4 | 5;

/** `body` as a plain object to read fields off, or `{}` for anything else — a malformed body reads as every field missing, so a required-field validator still reports it rather than this function throwing or short-circuiting on the first surprise. */
function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function compact(errors: readonly (FieldError | null)[]): FieldError[] {
  return errors.filter((error): error is FieldError => error !== null);
}

/** Step 1 — About you (2.3.1): `full_name`, `email`, `date_of_birth`. */
function validateStep1(record: Record<string, unknown>, asOf: Date): FieldError[] {
  return compact([
    validateFullName(record.full_name),
    validateEmail(record.email),
    validateDateOfBirth(record.date_of_birth, asOf),
  ]);
}

/** Step 2 — Body: `height_cm`, `weight_kg`. */
function validateStep2(record: Record<string, unknown>): FieldError[] {
  return compact([validateHeightCm(record.height_cm), validateWeightKg(record.weight_kg)]);
}

/** Step 3 — Medication: `glp1_current`, `glp1_medications` (depends on it), `other_medications`. */
function validateStep3(record: Record<string, unknown>): FieldError[] {
  return compact([
    validateAnsweredYesNo('glp1_current', record.glp1_current),
    validateGlp1Medications(record.glp1_medications, record.glp1_current),
    validateOptionalText('other_medications', record.other_medications),
  ]);
}

/** Step 4 — Health: `weight_conditions`, `thyroid_cancer_history`, `pancreatitis_history`, `other_conditions`, `alcohol_units_week`. */
function validateStep4(record: Record<string, unknown>): FieldError[] {
  return compact([
    validateWeightConditions(record.weight_conditions),
    validateAnsweredYesNo('thyroid_cancer_history', record.thyroid_cancer_history),
    validateAnsweredYesNo('pancreatitis_history', record.pancreatitis_history),
    validateOptionalText('other_conditions', record.other_conditions),
    validateAlcoholUnitsWeek(record.alcohol_units_week),
  ]);
}

/** Step 5 — Consent: `consent_data_processing`. */
function validateStep5(record: Record<string, unknown>): FieldError[] {
  return compact([validateConsentChecked(record.consent_data_processing)]);
}

const STEP_VALIDATORS: Record<
  IntakeStep,
  (record: Record<string, unknown>, asOf: Date) => FieldError[]
> = {
  1: validateStep1,
  2: validateStep2,
  3: validateStep3,
  4: validateStep4,
  5: validateStep5,
};

/**
 * Validates one step's fields (2.3: "Each Next → `PATCH` saves that step; the
 * server validates that step's fields", 2.5: "re-validates on every `PATCH`
 * (that step)"). `body` is the PATCH request body, read as-is — whatever
 * fields that step does not own are ignored, not flagged, since a PATCH only
 * carries its own step.
 */
export function validateIntakeStep(
  step: IntakeStep,
  body: unknown,
  asOf: Date = new Date(),
): FieldError[] {
  return STEP_VALIDATORS[step](asRecord(body), asOf);
}

/**
 * Validates every step's fields together (2.5: "re-validates ... on submit
 * (all steps)"). `body` is the whole submission's fields, steps 1–5's keys in
 * one object — the caller (submit) assembles this from whatever is stored
 * against the draft, `consent_data_processing` included: this function has no
 * database access of its own to look a granted consent event up with, so it
 * trusts the boolean it is handed for that one key exactly as it trusts every
 * other field.
 */
export function validateFullIntakeSubmission(body: unknown, asOf: Date = new Date()): FieldError[] {
  const record = asRecord(body);

  return [
    ...validateStep1(record, asOf),
    ...validateStep2(record),
    ...validateStep3(record),
    ...validateStep4(record),
    ...validateStep5(record),
  ];
}
