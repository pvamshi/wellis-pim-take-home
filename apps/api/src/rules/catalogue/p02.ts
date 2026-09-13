import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P02 — a patient row with no `legacy_id` at all.
 *
 * The id is the one value the whole migration addresses a row by: the import
 * keys on it (1.0.1), an intake points at it, a consent points at it. A row
 * that holds none is not a row with a bad value in one column — it is a row
 * nothing can reach. Whatever intakes and consents were meant for this patient
 * are unmatchable, and they stay that way until a human says which patient this
 * is.
 *
 * Ambiguous, and not marginally so: an id is issued by the old tool, not
 * derived from the rest of the row. There is nothing in `full_name`, `email` or
 * `signup_date` to compute one from, and inventing one would invent an identity
 * the export never had. So this rule reports and proposes nothing (1.1.12), and
 * its description is the whole of what the human reads.
 */

/**
 * Empty, or holding nothing but whitespace.
 *
 * The catalogue says "empty or missing" and both arrive here as text. An empty
 * cell in `patients.csv` lands as `''` — the import refuses a row whose id key
 * is absent altogether, so a missing id never reaches the table as anything
 * else — and `legacy_id` is `NOT NULL`, so there is no third case to test for.
 *
 * Whitespace-only counts, and that is a deliberate handoff rather than this
 * rule widening itself: P01 trims padding off an id, and stops short of the id
 * that is *only* padding, because trimming that one would propose the very
 * state this rule reports. One of the two rules has to own `'   '`, and it is
 * the rule that asks a human, not the rule that would silently empty the
 * column (1.1.4).
 */
function isUnaddressable(value: string): boolean {
  return value.trim().length === 0;
}

export const p02: CatalogueRule = {
  ruleId: 'P02',
  version: 1,
  ruleName: 'Patient legacy id is empty',
  description:
    'This patient row has no legacy id — the column is empty, or holds nothing but ' +
    'whitespace. Nothing in the migration can address the row: the intakes and consents ' +
    'that should point at it cannot be matched to it, and an id cannot be derived from ' +
    'the rest of the row, so someone has to say which patient this is.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every row missing an
   * id (1.1.14). Tests `legacy_id` and reports against `legacy_id` (1.1.5).
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.legacyPatientId;

      // An id with any content in it is this rule's business no further —
      // padding around a real id is P01's fix, and a space inside one is
      // neither rule's.
      if (!isUnaddressable(previous)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The empty id itself, which is the only address the row has. Two rows
        // with the same absent id collapse to one finding when the response is
        // persisted, exactly as two rows sharing a real id do (1.0.3) — a rule
        // row addresses a legacy id and not a physical row.
        legacyId: previous,
        column: 'legacy_id',
        // Reported verbatim, so `''` and `'   '` stay distinguishable to the
        // human reading the row rather than both being shown as nothing.
        prev: previous,
        // No value is proposed, and none can be (1.1.12).
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
