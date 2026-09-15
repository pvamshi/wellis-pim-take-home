import { bmiOf } from './bmi';
import type {
  EligibilityEvaluation,
  EligibilityInput,
  EligibilityRuleset,
  IntakeAutoStatus,
} from './eligibility-contract';
import { elig1 } from './rulesets/elig-1';

/**
 * Every registered ruleset, by version (2.7: "every version stays
 * registered" — a version is never removed from here, only superseded by
 * `ACTIVE_RULESET` naming a newer one).
 */
export const ELIGIBILITY_RULESETS: ReadonlyMap<string, EligibilityRuleset> = new Map([
  [elig1.version, elig1],
]);

/** The ruleset a submission or import is evaluated against right now (2.7). Changing a threshold is a new version and a new entry above, never an edit to this one's rules. */
export const ACTIVE_RULESET = elig1.version;

const CLEAR_EXPLANATION = 'cleared: no rule matched, for doctor review';

/**
 * Runs every rule of `rulesetVersion` against `input` and resolves the
 * outcome by precedence (2.7: reject > flag > clear). Evaluated once, at
 * submit or import — nothing here re-runs against a stored evaluation, and
 * nothing caches one; calling this twice for the same patient is the
 * caller's mistake to avoid, not this function's to guard against (2.7:
 * "Never re-evaluated").
 */
export function evaluate(
  rulesetVersion: string,
  input: EligibilityInput,
  asOf: Date = new Date(),
): EligibilityEvaluation {
  const ruleset = ELIGIBILITY_RULESETS.get(rulesetVersion);

  if (!ruleset) {
    throw new Error(`no eligibility ruleset is registered for version "${rulesetVersion}"`);
  }

  const results = ruleset.rules.map((rule) => rule.evaluate(input, asOf));

  const matchedRejects = results.filter((result) => result.matched && result.outcome === 'reject');
  const matchedFlags = results.filter((result) => result.matched && result.outcome === 'flag');

  const outcome: IntakeAutoStatus =
    matchedRejects.length > 0
      ? 'auto_rejected'
      : matchedFlags.length > 0
        ? 'auto_flagged'
        : 'auto_cleared';

  const explanation =
    matchedRejects.length > 0
      ? matchedRejects.map((result) => result.explanation).join('; ')
      : matchedFlags.length > 0
        ? matchedFlags.map((result) => result.explanation).join('; ')
        : CLEAR_EXPLANATION;

  return {
    rulesetVersion,
    results,
    outcome,
    explanation,
    bmi: bmiOf(input.heightCm, input.weightKg),
  };
}
