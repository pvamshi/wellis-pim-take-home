import { fieldError, type FieldError } from './field-error';
import { isoDate, isRealCalendarDate } from './date-utils';
import { ACCOUNT_STATUSES } from '../patient.entity';

/**
 * Field-level validators (2.5's table, one function per row). Each takes the
 * raw value exactly as it arrived in a request body — `unknown`, not the
 * typed column — because 2.5 makes the backend authoritative against
 * whatever a client actually sent, wrong type included, and hand-written
 * because tech-stack names no validation library (`approve.controller.ts`'s
 * own `readAddress` is the precedent this follows).
 *
 * Each returns `null` on a valid value or one `FieldError` naming itself —
 * never more than one per field, since a value is either acceptable or it
 * fails for the first reason checked. The step/full-submission/legacy
 * composites in the sibling files are what collect one of these per field
 * into the "every error collected" list 2.5 asks for.
 */

/** "none of these" (2.3.1's step 4): the one `weight_conditions` selection that combines with nothing else. */
export const NONE_OF_THESE = 'none of these';

export function validateFullName(value: unknown): FieldError | null {
  if (typeof value !== 'string') {
    return fieldError('full_name', value, 'full_name must be a string');
  }

  const trimmed = value.trim();

  if (trimmed.length < 2 || trimmed.length > 120) {
    return fieldError('full_name', value, 'full_name must be 2–120 characters');
  }

  if (!/[a-zA-Z]/.test(trimmed)) {
    return fieldError('full_name', value, 'full_name must contain at least one letter');
  }

  if (/\d/.test(trimmed)) {
    return fieldError('full_name', value, 'full_name must not contain a digit');
  }

  if (trimmed.includes('@')) {
    return fieldError('full_name', value, 'full_name must not contain "@"');
  }

  return null;
}

/** Trim + lowercase, as 2.1.1 stores it — callers apply this to whatever passed `validateEmail`, not the other way round. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Trim only, as 2.5's rule for `full_name` opens with — the counterpart of `normalizeEmail` for the field beside it. */
export function normalizeFullName(value: string): string {
  return value.trim();
}

export function validateEmail(value: unknown): FieldError | null {
  if (typeof value !== 'string') {
    return fieldError('email', value, 'email must be a string');
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return fieldError('email', value, 'email is required');
  }

  if (/\s/.test(trimmed)) {
    return fieldError('email', value, 'email must not contain whitespace');
  }

  if (trimmed.length > 254) {
    return fieldError('email', value, 'email must be at most 254 characters');
  }

  const atCount = (trimmed.match(/@/g) ?? []).length;

  if (atCount !== 1) {
    return fieldError('email', value, 'email must contain exactly one "@"');
  }

  const domain = trimmed.split('@')[1];

  if (!domain.includes('.')) {
    return fieldError('email', value, 'email domain must contain a "."');
  }

  return null;
}

export function validateDateOfBirth(value: unknown, asOf: Date = new Date()): FieldError | null {
  if (typeof value !== 'string') {
    return fieldError('date_of_birth', value, 'date_of_birth must be a string');
  }

  if (!isRealCalendarDate(value)) {
    return fieldError(
      'date_of_birth',
      value,
      'date_of_birth must be a real calendar date (YYYY-MM-DD)',
    );
  }

  if (value > isoDate(asOf)) {
    return fieldError('date_of_birth', value, 'date_of_birth must not be after today');
  }

  if (value < '1900-01-01') {
    return fieldError('date_of_birth', value, 'date_of_birth must not be before 1900-01-01');
  }

  return null;
}

export function validateHeightCm(value: unknown): FieldError | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fieldError('height_cm', value, 'height_cm must be a number');
  }

  if (value < 100 || value > 250) {
    return fieldError('height_cm', value, 'height_cm must be between 100 and 250');
  }

  return null;
}

export function validateWeightKg(value: unknown): FieldError | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fieldError('weight_kg', value, 'weight_kg must be a number');
  }

  if (value < 30 || value > 400) {
    return fieldError('weight_kg', value, 'weight_kg must be between 30 and 400');
  }

  return null;
}

/** A yes/no question answered (2.5: "yes / no fields | answered (intake)"). `field` names which one, since the same shape checks `glp1_current`, `thyroid_cancer_history` and `pancreatitis_history`. */
export function validateAnsweredYesNo(field: string, value: unknown): FieldError | null {
  if (typeof value !== 'boolean') {
    return fieldError(field, value, `${field} must be answered`);
  }

  return null;
}

export function validateWeightConditions(value: unknown): FieldError | null {
  if (!Array.isArray(value) || value.length === 0) {
    return fieldError(
      'weight_conditions',
      value,
      'weight_conditions must have at least one selection',
    );
  }

  if (!value.every((entry): entry is string => typeof entry === 'string')) {
    return fieldError('weight_conditions', value, 'weight_conditions must be a list of strings');
  }

  if (value.includes(NONE_OF_THESE) && value.length > 1) {
    return fieldError(
      'weight_conditions',
      value,
      '"none of these" cannot be combined with another selection',
    );
  }

  return null;
}

/**
 * `glp1_medications` depends on `glp1Current` (2.5: "≥1 when `glp1_current`
 * yes; empty when no"), so this is not a single-value check — it needs both
 * answers from the same step.
 */
export function validateGlp1Medications(value: unknown, glp1Current: unknown): FieldError | null {
  if (value !== undefined && !Array.isArray(value)) {
    return fieldError('glp1_medications', value, 'glp1_medications must be a list');
  }

  const medications = Array.isArray(value) ? value : [];

  if (glp1Current === true && medications.length === 0) {
    return fieldError(
      'glp1_medications',
      value,
      'glp1_medications must have at least one selection when glp1_current is yes',
    );
  }

  if (glp1Current === false && medications.length > 0) {
    return fieldError(
      'glp1_medications',
      value,
      'glp1_medications must be empty when glp1_current is no',
    );
  }

  return null;
}

export function validateAlcoholUnitsWeek(value: unknown): FieldError | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value)) {
    return fieldError('alcohol_units_week', value, 'alcohol_units_week must be a whole number');
  }

  if ((value as number) < 0 || (value as number) > 200) {
    return fieldError('alcohol_units_week', value, 'alcohol_units_week must be between 0 and 200');
  }

  return null;
}

/** An optional free-text field — no shape beyond "a string, if present at all" (2.3.1's "long text" questions). */
export function validateOptionalText(field: string, value: unknown): FieldError | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return fieldError(field, value, `${field} must be a string`);
  }

  return null;
}

export function validateConsentChecked(value: unknown): FieldError | null {
  if (value !== true) {
    return fieldError('consent_data_processing', value, 'consent_data_processing must be checked');
  }

  return null;
}

// --- Legacy-only fields (2.5's last six table rows) --------------------------------------------

export function validateSex(value: unknown): FieldError | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value !== 'M' && value !== 'F') {
    return fieldError('sex', value, 'sex must be null, "M" or "F"');
  }

  return null;
}

/**
 * The Dutch eleven-proef: each of the 9 digits weighted 9..2 then -1, summed;
 * a valid BSN's sum is a multiple of 11.
 */
function passesElevenProef(digits: string): boolean {
  const weights = [9, 8, 7, 6, 5, 4, 3, 2, -1];
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);

  return sum % 11 === 0;
}

export function validateBsn(value: unknown): FieldError | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string' || !/^\d{9}$/.test(value)) {
    return fieldError('bsn', value, 'bsn must be null or 9 digits');
  }

  if (!passesElevenProef(value)) {
    return fieldError('bsn', value, 'bsn must pass the eleven-proef checksum');
  }

  return null;
}

const E164 = /^\+\d{8,15}$/;

export function validatePhone(value: unknown): FieldError | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string' || !E164.test(value)) {
    return fieldError('phone', value, 'phone must be null or E.164 ("+" then 8–15 digits)');
  }

  return null;
}

export function validateAccountStatus(value: unknown): FieldError | null {
  if (typeof value !== 'string' || !(ACCOUNT_STATUSES as readonly string[]).includes(value)) {
    return fieldError(
      'account_status',
      value,
      `account_status must be one of ${ACCOUNT_STATUSES.join(', ')}`,
    );
  }

  return null;
}

export function validateSignupDate(value: unknown, asOf: Date = new Date()): FieldError | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string' || !isRealCalendarDate(value)) {
    return fieldError(
      'signup_date',
      value,
      'signup_date must be null or a real calendar date (YYYY-MM-DD)',
    );
  }

  if (value > isoDate(asOf)) {
    return fieldError('signup_date', value, 'signup_date must not be after today');
  }

  return null;
}

/**
 * 2.5: "weight (legacy) | weight_unit is kg, or empty — kg is the default (D6)".
 * Named `weight`, the row's own field name, even though the value at fault is
 * the unit. A pounds weight fails: converting it is deferred (D6).
 */
export function validateLegacyWeightUnit(weightUnit: unknown): FieldError | null {
  if (weightUnit === null || weightUnit === undefined) return null;
  if (typeof weightUnit === 'string' && weightUnit.trim() === '') return null;

  if (typeof weightUnit !== 'string' || weightUnit.trim().toLowerCase() !== 'kg') {
    return fieldError('weight', weightUnit, 'weight must be recorded in kg');
  }

  return null;
}
