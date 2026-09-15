/** One field that failed 2.5's rules — the 422 body's own shape (2.9: `{ message, errors: [{ field, value, reason }] }`). */
export interface FieldError {
  readonly field: string;
  readonly value: unknown;
  readonly reason: string;
}

/** Builds one `FieldError`. A tiny helper, but every validator in this directory returns through it, so the three keys are never typed out of order twice. */
export function fieldError(field: string, value: unknown, reason: string): FieldError {
  return { field, value, reason };
}
