import { NONE_OF_THESE } from './options';

/**
 * Client-side mirrors of 2.5's field rules, one function per row of that
 * table (2.5: "Written twice — no shared package").
 *
 * The backend (`apps/api/src/patient/validation/field-validators.ts`) is
 * authoritative and re-validates every one of these on every `PATCH` and on
 * submit (2.5) — what is here exists only so Next is blocked before a round
 * trip, per this same section's "Frontend: `@mantine/form` per step; errors
 * on blur and on Next; Next blocked until the step is valid." A message here
 * disagreeing with the backend's own wording is not a bug: only the bound
 * each rule checks has to agree, because a field the backend rejects is
 * re-shown with the backend's own `reason` (`fieldErrorsToFormErrors`), not
 * this file's text.
 */

export function validateFullName(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed.length < 2 || trimmed.length > 120) return 'Enter 2–120 characters.';
  if (!/[a-zA-Z]/.test(trimmed)) return 'Must contain at least one letter.';
  if (/\d/.test(trimmed)) return 'Must not contain a digit.';
  if (trimmed.includes('@')) return 'Must not contain "@".';

  return null;
}

export function validateEmail(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed.length === 0) return 'Email is required.';
  if (/\s/.test(trimmed)) return 'Must not contain whitespace.';
  if (trimmed.length > 254) return 'Must be at most 254 characters.';

  const atCount = (trimmed.match(/@/g) ?? []).length;
  if (atCount !== 1) return 'Must contain exactly one "@".';

  const domain = trimmed.split('@')[1] ?? '';
  if (!domain.includes('.')) return 'The domain must contain a ".".';

  return null;
}

/** `YYYY-MM-DD`, matching 2.0's date convention and what a native `<input type="date">` produces. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_DATE_OF_BIRTH = '1900-01-01';

function isRealCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function validateDateOfBirth(value: string): string | null {
  if (value.trim().length === 0) return 'Date of birth is required.';
  if (!isRealCalendarDate(value)) return 'Enter a real calendar date.';

  const today = new Date().toISOString().slice(0, 10);
  if (value > today) return 'Cannot be after today.';
  if (value < MIN_DATE_OF_BIRTH) return `Cannot be before ${MIN_DATE_OF_BIRTH}.`;

  return null;
}

export function validateHeightCm(value: number | ''): string | null {
  if (value === '') return 'Height is required.';
  if (value < 100 || value > 250) return 'Enter a height between 100 and 250 cm.';

  return null;
}

export function validateWeightKg(value: number | ''): string | null {
  if (value === '') return 'Weight is required.';
  if (value < 30 || value > 400) return 'Enter a weight between 30 and 400 kg.';

  return null;
}

/** A yes/no question answered (2.5: "yes / no fields | answered (intake)") — `null` is "not yet answered", never read as "no". */
export function validateYesNo(value: boolean | null): string | null {
  return value === null ? 'Choose yes or no.' : null;
}

export function validateWeightConditions(value: readonly string[]): string | null {
  if (value.length === 0) return 'Select at least one option.';
  if (value.includes(NONE_OF_THESE) && value.length > 1) {
    return '"None of these" cannot be combined with another selection.';
  }

  return null;
}

/** `glp1_medications` depends on `glp1_current` (2.5), so this needs both answers, not just its own field. */
export function validateGlp1Medications(
  medications: readonly string[],
  glp1Current: boolean | null,
): string | null {
  return glp1Current === true && medications.length === 0
    ? 'Select at least one medication, or specify which under "Other".'
    : null;
}

export function validateAlcoholUnitsWeek(value: number | ''): string | null {
  if (value === '') return null;
  if (!Number.isInteger(value)) return 'Enter a whole number.';
  if (value < 0 || value > 200) return 'Enter a number between 0 and 200.';

  return null;
}

export function validateConsentChecked(value: boolean): string | null {
  return value ? null : 'You must agree before continuing.';
}
