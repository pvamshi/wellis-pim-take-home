/**
 * One field that failed 2.5's rules — the 422 body's own shape (2.9: `{
 * message, errors: [{ field, value, reason }] }`).
 *
 * `field` is nullable for B4's bulk import (2.6): a row that fails a
 * precondition rather than a field rule reports `{ field: null, value: null,
 * reason }` in the same array, so one shape covers both.
 */
export interface FieldError {
  readonly field: string | null;
  readonly value: unknown;
  readonly reason: string;
}

/** Builds one `FieldError`. A tiny helper, but every validator in this directory returns through it, so the three keys are never typed out of order twice. */
export function fieldError(field: string | null, value: unknown, reason: string): FieldError {
  return { field, value, reason };
}
