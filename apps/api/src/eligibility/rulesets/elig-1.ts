import { computeAgeYears } from '../age';
import { bmiOf, formatBmi } from '../bmi';
import type {
  EligibilityInput,
  EligibilityRule,
  EligibilityRuleResult,
  EligibilityRuleset,
} from '../eligibility-contract';
import { NONE_OF_THESE } from '../../patient/validation/field-validators';

/**
 * `elig-1` (2.7): the six rules a submission is judged by, all always run,
 * every result stored.
 *
 * Two things every rule here shares, worth stating once instead of six
 * times:
 *
 * - **A missing answer a rule needs matches it as a flag** (2.7), never as a
 *   clear — "not recorded (legacy)" wording, since the only way a rule's own
 *   input is missing is a legacy import that never asked (2.5, 2.6). E1's
 *   `dateOfBirth` is never null. E3 (`weightConditions`), E4 (`glp1Current`),
 *   E5 (`thyroidCancerHistory`/`pancreatitisHistory`) and E6 (no
 *   `data_processing` consent event on record) flag a missing answer — E6's is
 *   an empty `consentEvents` list rather than a null field, since consent is a
 *   history, not a single answer.
 * - **BMI is the exception** (2.7): missing height or weight rejects through
 *   E2, and E3 reads the missing BMI as not matched.
 * - **Every rule also has a not-matched explanation.** 2.7 gives literal
 *   wording only for the matched case; the not-matched wording below is this
 *   ruleset's own choice (spec silent), built the same way — outcome-free
 *   prose stating the fact that kept the rule from matching, so a reviewer
 *   reading an unmatched entry sees why, not just that it did not fire.
 */

function matched(
  ruleId: string,
  outcome: EligibilityRuleResult['outcome'],
  explanation: string,
): EligibilityRuleResult {
  return { ruleId, matched: true, outcome, explanation };
}

function notMatched(
  ruleId: string,
  outcome: EligibilityRuleResult['outcome'],
  explanation: string,
): EligibilityRuleResult {
  return { ruleId, matched: false, outcome, explanation };
}

/** E1 — age under 18 at submission (2.7). `dateOfBirth` is never null, so this rule has no "not recorded" branch. */
const e1: EligibilityRule = {
  ruleId: 'E1',
  outcome: 'reject',
  evaluate(input: EligibilityInput, asOf: Date): EligibilityRuleResult {
    const age = computeAgeYears(input.dateOfBirth, asOf);

    if (age < 18) {
      return matched('E1', 'reject', `rejected: age ${age} at submission, under 18`);
    }

    return notMatched('E1', 'reject', `age ${age} at submission, 18 or over`);
  },
};

/** E2 — BMI below 27.0, or not recorded (2.7), compared rounded so 26.96 reads as 27.0 and clears. */
const e2: EligibilityRule = {
  ruleId: 'E2',
  outcome: 'reject',
  evaluate(input: EligibilityInput): EligibilityRuleResult {
    const bmi = bmiOf(input.heightCm, input.weightKg);

    if (bmi === null) {
      return matched(
        'E2',
        'reject',
        'rejected: BMI not recorded (legacy), height or weight missing',
      );
    }

    if (bmi < 27.0) {
      return matched('E2', 'reject', `rejected: BMI ${formatBmi(bmi)}, below 27`);
    }

    return notMatched('E2', 'reject', `BMI ${formatBmi(bmi)}, 27 or above`);
  },
};

/**
 * E3 — BMI 27.0–30.0 with no weight-related condition (2.7).
 *
 * A BMI outside the range — or none at all, which E2 already rejects —
 * decides "not matched" on its own, before `weightConditions` is even looked
 * at — its null case (legacy, never asked) only matters when BMI is in range,
 * which is the one situation where this rule actually needs to know it.
 */
const e3: EligibilityRule = {
  ruleId: 'E3',
  outcome: 'flag',
  evaluate(input: EligibilityInput): EligibilityRuleResult {
    const bmi = bmiOf(input.heightCm, input.weightKg);

    if (bmi === null) {
      return notMatched('E3', 'flag', 'BMI not recorded, rejected by E2');
    }

    if (bmi < 27.0 || bmi > 30.0) {
      return notMatched('E3', 'flag', `BMI ${formatBmi(bmi)}, outside 27.0–30.0`);
    }

    if (input.weightConditions === null) {
      return matched('E3', 'flag', 'flagged: weight-related conditions not recorded (legacy)');
    }

    const hasCondition = input.weightConditions.some((condition) => condition !== NONE_OF_THESE);

    if (!hasCondition) {
      return matched(
        'E3',
        'flag',
        `flagged: BMI ${formatBmi(bmi)} with no weight-related condition`,
      );
    }

    return notMatched('E3', 'flag', `BMI ${formatBmi(bmi)} with a weight-related condition`);
  },
};

/** E4 — currently using a GLP-1 medication (2.7). The matched explanation names which ones, when any are on record. */
const e4: EligibilityRule = {
  ruleId: 'E4',
  outcome: 'flag',
  evaluate(input: EligibilityInput): EligibilityRuleResult {
    if (input.glp1Current === null) {
      return matched('E4', 'flag', 'flagged: GLP-1 use not recorded (legacy)');
    }

    if (input.glp1Current) {
      const named =
        input.glp1Medications && input.glp1Medications.length > 0
          ? ` (${input.glp1Medications.join(', ')})`
          : '';

      return matched('E4', 'flag', `flagged: currently using a GLP-1 medication${named}`);
    }

    return notMatched('E4', 'flag', 'not currently using a GLP-1 medication');
  },
};

/**
 * E5 — a self-reported history of thyroid cancer or pancreatitis (2.7).
 *
 * A definite "yes" on either wins over the other's "not recorded" — the rule
 * already knows enough to match, so a still-unanswered sibling field cannot
 * make that any less true. Only when neither is a definite "yes" does either
 * field's null state matter.
 */
const e5: EligibilityRule = {
  ruleId: 'E5',
  outcome: 'flag',
  evaluate(input: EligibilityInput): EligibilityRuleResult {
    const conditions: string[] = [];

    if (input.thyroidCancerHistory === true) conditions.push('thyroid cancer');
    if (input.pancreatitisHistory === true) conditions.push('pancreatitis');

    if (conditions.length > 0) {
      return matched('E5', 'flag', `flagged: self-reported history of ${conditions.join(' and ')}`);
    }

    if (input.thyroidCancerHistory === null || input.pancreatitisHistory === null) {
      return matched(
        'E5',
        'flag',
        'flagged: thyroid cancer / pancreatitis history not recorded (legacy)',
      );
    }

    return notMatched('E5', 'flag', 'no self-reported history of thyroid cancer or pancreatitis');
  },
};

/** `at`'s calendar date, for the explanation — `at` is always ISO-8601 UTC (2.0 conventions), so slicing is exact, no parsing needed. */
function consentEventDate(at: string): string {
  return at.slice(0, 10);
}

/**
 * E6 — the latest `data_processing` consent event, by `at`, is revoked
 * (2.7). Its own category is `reject`, but a missing answer still flags
 * rather than rejects, per the general rule above: no consent event at all
 * is not evidence of revocation, only of an import that never carried one —
 * an intake always has a granted event from step 5 (2.3.1), so that branch
 * only ever matches a legacy import.
 */
const e6: EligibilityRule = {
  ruleId: 'E6',
  outcome: 'reject',
  evaluate(input: EligibilityInput): EligibilityRuleResult {
    const dataProcessingEvents = input.consentEvents.filter(
      (event) => event.type === 'data_processing',
    );

    if (dataProcessingEvents.length === 0) {
      return matched('E6', 'flag', 'flagged: data processing consent not recorded (legacy)');
    }

    const latest = dataProcessingEvents.reduce((latestSoFar, event) =>
      event.at > latestSoFar.at ? event : latestSoFar,
    );

    if (latest.action === 'revoked') {
      return matched(
        'E6',
        'reject',
        `rejected: data processing consent revoked on ${consentEventDate(latest.at)}`,
      );
    }

    return notMatched(
      'E6',
      'reject',
      `data processing consent granted on ${consentEventDate(latest.at)}, not revoked`,
    );
  },
};

export const elig1: EligibilityRuleset = {
  version: 'elig-1',
  rules: [e1, e2, e3, e4, e5, e6],
};
