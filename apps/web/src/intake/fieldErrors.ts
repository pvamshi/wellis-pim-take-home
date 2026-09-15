import type { FieldError } from '../api/types';

/**
 * A 422/409 `errors` array (2.9), reshaped into the `{ field: message }` map
 * `@mantine/form`'s `form.setErrors` takes.
 *
 * An error naming no field (`field: null`) has nowhere on a step form to
 * attach to — every backend validator behind a `PATCH`/submit names a real
 * field (2.5's table has none that don't), so this only ever drops what
 * should not occur here at all, never a real answer. `field: null` is
 * B7/2.6's own shape, read separately by the rows screen's import failures.
 */
export function fieldErrorsToFormErrors(errors: readonly FieldError[]): Record<string, string> {
  const out: Record<string, string> = {};

  for (const error of errors) {
    if (error.field !== null) out[error.field] = error.reason;
  }

  return out;
}
