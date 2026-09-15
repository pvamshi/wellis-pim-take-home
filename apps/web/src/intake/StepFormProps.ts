import type { FieldError } from '../api/types';

/**
 * What every one of the six step components shares (2.3.1). Each step owns
 * its own `@mantine/form` instance and its own client-side validation
 * (2.5); `IntakePage` owns the network call and the move to the next step,
 * so a step never knows an intake id or a URL.
 */
export interface StepFormProps<Values> {
  /** This step's fields as last saved, or the defaults for a step never reached yet. */
  readonly initialValues: Values;
  /** True while `IntakePage` is saving this step — disables every input and the Next button. */
  readonly busy: boolean;
  /** The backend's own field errors from the last failed save, or null. Re-validating on the server (2.5) can disagree with this step's own client-side check, and the server is what actually decides. */
  readonly serverErrors: readonly FieldError[] | null;
  /** Undefined only on step 1 — the one step with nowhere to go back to. */
  readonly onBack?: () => void;
  /** Called once this step's own form has passed client-side validation. `IntakePage` PATCHes and only then moves on. */
  readonly onNext: (fields: Record<string, unknown>) => void;
}
