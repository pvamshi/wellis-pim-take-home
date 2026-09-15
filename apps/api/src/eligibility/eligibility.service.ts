import { Injectable } from '@nestjs/common';
import { ACTIVE_RULESET, evaluate } from './eligibility-registry';
import type { EligibilityEvaluation, EligibilityInput } from './eligibility-contract';

/**
 * The `eligibility` module's one entry point (2.0): a thin, injectable
 * wrapper over `evaluate`, so a future caller (B3's submit flow, B4's import)
 * reaches this the same way it reaches every other module's service, while
 * the actual rule logic stays a plain function `eligibility.spec.ts` can call
 * directly with no Nest wiring at all.
 */
@Injectable()
export class EligibilityService {
  /** Evaluates against `ACTIVE_RULESET` unless a caller names an older version explicitly — there is no reason to today, since nothing re-evaluates a stored row (2.7). */
  evaluate(
    input: EligibilityInput,
    asOf: Date = new Date(),
    rulesetVersion: string = ACTIVE_RULESET,
  ): EligibilityEvaluation {
    return evaluate(rulesetVersion, input, asOf);
  }
}
