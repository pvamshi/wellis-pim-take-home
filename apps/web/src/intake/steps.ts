import type { IntakeStep } from '../api/types';

/** The five validated steps' own titles (2.3.1) — the Stepper's labels and the review step's section headings share these, so the two never say a step by two different names. */
export const STEP_TITLES: Record<IntakeStep, string> = {
  1: 'About you',
  2: 'Body',
  3: 'Medication',
  4: 'Health',
  5: 'Consent',
};

/**
 * Which step owns each questionnaire field (2.3.1).
 *
 * Submit re-validates every step at once (2.5) and answers one flat list of
 * field errors, unlike a per-step `PATCH`, which only ever fails on the step
 * that was just sent. This is what lets the check-and-submit step (2.3.1's
 * step 6) turn each of those back into an "edit step N" link instead of
 * showing a wall of field names nobody can place.
 */
export const STEP_OF_FIELD: Record<string, IntakeStep> = {
  full_name: 1,
  email: 1,
  date_of_birth: 1,
  height_cm: 2,
  weight_kg: 2,
  glp1_current: 3,
  glp1_medications: 3,
  other_medications: 3,
  weight_conditions: 4,
  thyroid_cancer_history: 4,
  pancreatitis_history: 4,
  other_conditions: 4,
  alcohol_units_week: 4,
  consent_data_processing: 5,
};
