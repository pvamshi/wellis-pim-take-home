import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P01 — a patient's `legacy_id` with whitespace around it.
 *
 * The id is the one value the whole migration addresses a row by: the import
 * keys on it (1.0.1), an intake points at it, a consent points at it. A stray
 * space on either end makes `"recABC "` a different string from `"recABC"`
 * everywhere that comparison happens, so this is a small fix with a wide blast
 * radius — which is why it is the first rule in the catalogue.
 *
 * Not ambiguous: the trimmed id is the only reading of `" recABC"` there is.
 */

/**
 * Only the ends, never the middle.
 *
 * `trim` and nothing more. The catalogue says "leading or trailing whitespace"
 * here, and says "leading, trailing or doubled internal whitespace" for
 * `full_name` (P03) — the difference between the two entries is deliberate, and
 * collapsing an inner space would be this rule taking a second fix that is not
 * its own (1.1.4). An id with a space in the middle of it is left exactly as it
 * is, for a rule that is asked for it.
 */
function trimmed(value: string): string {
  return value.trim();
}

export const p01: CatalogueRule = {
  ruleId: 'P01',
  version: 1,
  ruleName: 'Patient legacy id has whitespace around it',
  description:
    "The patient's legacy id has whitespace before or after it. The trimmed id is proposed.",
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every id that would
   * change (1.1.14). Tests `legacy_id` and changes `legacy_id` (1.1.5), so an
   * approved row stops matching the next time the rules run.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.legacyPatientId;
      const next = trimmed(previous);

      // Nothing to propose when the id is already clean.
      if (next === previous) {
        continue;
      }

      // All whitespace, so the trim leaves nothing. Proposing an empty id would
      // be proposing the very state P02 calls a row that cannot be addressed at
      // all — and P02 is the rule that finds it and asks a human (1.1.4). This
      // one walks past.
      if (next.length === 0) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The untrimmed id, because it is what the row is addressed by until
        // the change is applied.
        legacyId: previous,
        column: 'legacy_id',
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
