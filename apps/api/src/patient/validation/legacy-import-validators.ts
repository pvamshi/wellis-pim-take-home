import type { FieldError } from './field-error';
import {
  validateAccountStatus,
  validateBsn,
  validateDateOfBirth,
  validateEmail,
  validateFullName,
  validateHeightCm,
  validateLegacyWeightUnit,
  validatePhone,
  validateSex,
  validateSignupDate,
  validateWeightKg,
} from './field-validators';

/**
 * Validates one legacy patient row for import (2.5: "Legacy import applies
 * the identity rules, and the body rules to any value present; height,
 * weight, medication and health answers may be null."). A missing height or
 * weight is not an error here: E2 rejects it with a reason a reviewer sees (2.7).
 *
 * `body` carries the row already mapped into `patient`'s own field names and
 * types (2.6's mapping table is the import service's job, not this
 * function's) — `weight_kg` as the converted number, alongside the source
 * `weight_unit` string the conversion is only valid for. Nothing here reads
 * `glp1_current`, `weight_conditions`, `thyroid_cancer_history` or
 * `pancreatitis_history`: 2.6 maps all four to null unconditionally, so there
 * is nothing on this path for those rules to check.
 */
export function validateLegacyImportPatient(body: unknown): FieldError[] {
  const record =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const errors = [
    validateFullName(record.full_name),
    validateEmail(record.email),
    validateDateOfBirth(record.date_of_birth),
    isMissing(record.height_cm) ? null : validateHeightCm(record.height_cm),
    isMissing(record.weight_kg) ? null : validateWeightKg(record.weight_kg),
    isMissing(record.weight_kg) ? null : validateLegacyWeightUnit(record.weight_unit),
    validateSex(record.sex),
    validateBsn(record.bsn),
    validatePhone(record.phone),
    validateAccountStatus(record.account_status),
    validateSignupDate(record.signup_date),
  ];

  return errors.filter((error): error is FieldError => error !== null);
}

function isMissing(value: unknown): boolean {
  return value === null || value === undefined;
}
