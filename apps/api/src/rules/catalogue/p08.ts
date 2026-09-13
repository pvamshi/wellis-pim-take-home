import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P08 — a patient row with no `full_name` at all.
 *
 * The name is what every screen greets the patient by and what every letter is
 * addressed to, and a row holding none has nothing to put there. It is also the
 * value two of the duplicate rules compare on: a nameless row cannot be matched
 * to the second signup that is the same person under a different email, so it
 * arrives in the new system as its own patient and stays that way.
 *
 * Ambiguous, and there is no argument about it: a name is not derivable from
 * anything else the export holds. An email address may hint at one — `email` on
 * this row could read `j.smit@gmail.com` — but Jan Smit, Julia Smit and a
 * household mailbox all write that address, and filling the column from a hint
 * would invent a person. `bsn`, `dob` and `city` say nothing at all about what
 * someone is called. So this rule reports and proposes nothing (1.1.12), and
 * its description is the whole of what the human reads.
 *
 * Three ways a cell arrives with no name in it, and all three are this rule's:
 *
 * - `null`, because `full_name` is nullable and a row whose source had no such
 *   column lands that way.
 * - `''`, an empty cell in `patients.csv`.
 * - whitespace only, a cell somebody typed three spaces into.
 *
 * The last one is a handoff, not this rule widening itself. P03 cleans stray
 * whitespace out of a name and stops short of the name that is *only*
 * whitespace, because cleaning that one would propose the very state reported
 * here. One of the two rules has to own a cell of three spaces, and it is the
 * rule that asks a human rather than the rule that would silently empty the
 * column (1.1.4). P07 walks past all three for the same reason: a row with no
 * name is not a row whose name is an email address.
 *
 * The column is only read, and only this one. Whatever `email`, `phone` or
 * `legacy_id` holds is another rule's business — this rule tests `full_name`
 * and reports against `full_name` (1.1.5).
 */

/**
 * True when the cell holds no name: absent, empty, or nothing but whitespace.
 *
 * Trimming is what folds the three cases into one. A tab and a run of spaces
 * are as empty as `''` to the human who opens the row, and a rule that reported
 * the one and not the other would leave a nameless row with no rule at all.
 */
function isNameless(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const p08: CatalogueRule = {
  ruleId: 'P08',
  version: 1,
  ruleName: 'Patient name is empty',
  description:
    'This patient row has no name — the column is empty, or holds nothing but whitespace. ' +
    'Nothing else in the row says what the person is called: an email address or a date of ' +
    'birth identifies someone without naming them, so the name has to come from a human or ' +
    'from a source outside this export.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every row with no
   * name (1.1.14). Tests `full_name` and reports against `full_name` (1.1.5).
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.fullName;

      // A cell with any name in it is this rule's business no further. Padding
      // around a real name is P03's fix, a name that is contact detail is P07's
      // finding, and a name with no surname is P09's — each its own rule and
      // its own approval (1.1.4).
      if (!isNameless(previous)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `full_name`, so
        // the id is only the address — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'full_name',
        // Reported verbatim, so an absent name, an empty one and a cell with
        // three spaces in it stay distinguishable to the human reading the row
        // rather than all three being shown as the same nothing.
        prev: previous,
        // No value is proposed, and none can be (1.1.12).
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
