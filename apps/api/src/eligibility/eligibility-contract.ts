import type { EvaluationEntry, EvaluationOutcome } from '../patient/patient.entity';
import type { ConsentEventAction, ConsentEventType } from '../consent/consent-event.entity';

/**
 * The contract between the registry and one ruleset's rule code. Separate
 * from the Part A rule engine's `RuleContext`/`RuleResponse` (2.7: "a Part A
 * rule proposes a change and waits for a human; a ruleset classifies a
 * submission on the spot") — no database access, no findings, one patient in
 * and one verdict out, synchronously.
 */

/**
 * One `consent_event` row (2.1.2), reduced to what E6 needs — which type,
 * which way, and when — never the entity itself, the same snapshot boundary
 * `EligibilityInput` draws for the rest of a patient's data.
 */
export interface EligibilityConsentEvent {
  readonly type: ConsentEventType;
  readonly action: ConsentEventAction;
  /** ISO UTC (2.0 conventions) — same format `consent_event.at` stores, compared as a string to find the latest event. */
  readonly at: string;
}

/** What `evaluate` needs of a patient — a snapshot, not the ORM entity, so a rule cannot reach for a column 2.7 never gave it. Null throughout for whatever "medication and health may be null" (2.5) leaves unanswered on a legacy row. 2.0's architecture table names this module's contract `evaluate(patient, consentEvents)`; `consentEvents` joins the rest of the snapshot here rather than arriving as a second parameter, so E6 reads it the same way every other rule reads its own fields — through `input`, not through something only the registry's entry point sees. */
export interface EligibilityInput {
  /** `YYYY-MM-DD`. Never null — identity rules apply to every origin (2.5). */
  readonly dateOfBirth: string;
  /** Null only on a legacy import that never recorded it (2.5); E2 then rejects for a missing BMI (2.7). */
  readonly heightCm: number | null;
  readonly weightKg: number | null;
  readonly glp1Current: boolean | null;
  readonly glp1Medications: readonly string[] | null;
  readonly weightConditions: readonly string[] | null;
  readonly thyroidCancerHistory: boolean | null;
  readonly pancreatitisHistory: boolean | null;
  /** Every consent event on record for this patient (2.1.2), in any order — E6 finds the latest `data_processing` one itself. Empty, never null, when there is none: 2.7 treats "no consent event at all" as E6's own missing-answer case (flag), not as a separate null state a caller has to pre-check. */
  readonly consentEvents: readonly EligibilityConsentEvent[];
}

/** The category a rule's own match belongs to — an alias of `patient.evaluation`'s own `EvaluationOutcome`, never `'clear'`: clear is the absence of every rule's match, not a rule's own verdict. */
export type EligibilityOutcome = EvaluationOutcome;

/**
 * One rule's result (2.7's "every rule's result" — six of these, always, one
 * per rule in the ruleset, whether it matched or not). `outcome` is the
 * rule's own fixed category regardless of `matched` — except E6, whose
 * missing-consent-event match flags rather than rejects (2.7's general "a
 * missing answer matches as a flag", not a clear); every other rule's own
 * category is constant across matched and not-matched alike, so a reviewer
 * reading an unmatched entry still sees what kind of finding that rule looks
 * for.
 *
 * An alias of `patient.evaluation`'s own element type, not a lookalike of it
 * — `patient.evaluation` is stored exactly as `evaluate` returns it, so there
 * is one shape, owned by the entity whose column it is, and eligibility
 * depends on patient (2.7: "evaluate(patient)") rather than the other way.
 */
export type EligibilityRuleResult = EvaluationEntry;

/** One rule of a ruleset: a fixed id and category, and the function that decides whether it matches this submission. */
export interface EligibilityRule {
  readonly ruleId: string;
  readonly outcome: EligibilityOutcome;
  evaluate(input: EligibilityInput, asOf: Date): EligibilityRuleResult;
}

/** A versioned, registered set of rules (2.7: "Rulesets are code, registered by version; every version stays registered."). */
export interface EligibilityRuleset {
  readonly version: string;
  readonly rules: readonly EligibilityRule[];
}

/** The `intake_status` an evaluation resolves to (2.7) — ready to hand straight to `IntakeStateMachine.transition` as `to`. */
export type IntakeAutoStatus = 'auto_cleared' | 'auto_flagged' | 'auto_rejected';

/**
 * What one call to `evaluate` produces: every rule's result, stored as-is on
 * `patient.evaluation`, and the outcome those results resolve to by
 * precedence (2.7: "any reject → `auto_rejected`; else any flag →
 * `auto_flagged`; else `auto_cleared`").
 *
 * `explanation` is a headline for the overall verdict — not asked for by name
 * in 2.7's column table, but its "nothing matched" row gives an exact string
 * ("cleared: no rule matched, for doctor review") that has to live somewhere,
 * and every matched rule already has one string worth surfacing as "why" — so
 * this joins the matched reject (or matched flag) explanations, or falls back
 * to that literal string when none matched. `results` is still the complete
 * record; this is a convenience alongside it, not a replacement for it.
 */
export interface EligibilityEvaluation {
  readonly rulesetVersion: string;
  readonly results: readonly EligibilityRuleResult[];
  readonly outcome: IntakeAutoStatus;
  readonly explanation: string;
  /** The rounded BMI this evaluation used (2.7) — handed back so a caller can store it on `patient.bmi` without recomputing it. Null when height or weight is missing. */
  readonly bmi: number | null;
}
