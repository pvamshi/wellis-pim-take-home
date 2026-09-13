import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P15 — a patient row with no `email` at all: the column absent, the cell
 * empty, or the cell holding nothing but whitespace.
 *
 * The export notes call this column the primary contact and say one of the
 * later automations used it as a login. That second sentence is why an empty
 * cell here is worth a human's attention rather than a shrug: nothing sent to
 * this patient ever arrives, and the account the automation expects to exist
 * has no key, so nobody — the patient included — can sign in as them. It is
 * also the value D01 matches duplicates on, so the second signup that is the
 * same person cannot be found from this side of the pair.
 *
 * An empty cell is the honest version of the problem P12 and P14 report. Both
 * of those cells claim to hold an address and do not; this one claims nothing.
 * The finding is the same missing address, and the sentence a human reads about
 * it is different, which is why it is a rule of its own (1.1.4).
 *
 * Ambiguous, and not marginally so: an address is not derivable from anything
 * else the export holds. `full_name`, `dob`, `bsn` and `city` identify a person
 * without saying where their post goes, and `phone` is a different channel, not
 * an address in another column. Constructing `jan.devries@` plus a guessed
 * provider would invent a mailbox and — because this column is a login — hand
 * an account to whoever already owns that address. So this rule reports and
 * proposes nothing (1.1.12), and its description is the whole of what the human
 * reads. What they do with it is supply the real address, or record that this
 * person has none, and only they can know which.
 *
 * Three ways a cell arrives with no address in it, and all three are this
 * rule's:
 *
 * - `null`, because `email` is nullable and a row whose source had no such
 *   column lands that way.
 * - `''`, an empty cell in `patients.csv`.
 * - whitespace only, a cell somebody typed a space or a tab into.
 *
 * The last one is a handoff and not this rule widening itself. P10 trims the
 * ends of an address and stops short of the cell that is *only* padding,
 * because trimming that one would propose the very state reported here. One of
 * the two rules has to own a cell of three spaces, and it is the rule that asks
 * a human rather than the rule that would silently empty the column (1.1.4).
 * P11, P12, P13 and P14 walk past all three cases for the same reason: a row
 * with no address is not a row whose address is misspelt, malformed, doubled or
 * pretended.
 *
 * Every cell with something in it is walked past here, whatever is wrong with
 * that something, and whose it is:
 *
 * - **A real address** — nothing to report, which is what the column is for.
 * - **Padding or capitals around a real address** — P10's fix. `"  eva@live.nl
 *   "` holds an address; it is untidy, not absent.
 * - **A misspelt provider** — P11's fix.
 * - **A value that is not an address at all**, `"n.v.t."`, `"geen"`, `"-"` —
 *   P12's finding. A note in the wrong box is a cell pretending not to be
 *   empty, and P12's sentence about it is the true one.
 * - **A placeholder**, `test@test.com`, `noemail@` — P14's finding, and the
 *   same pretence with an `@` in it.
 * - **Two addresses in one cell** — P13's finding, which is the opposite
 *   problem.
 *
 * The column is only read, and only this one. An empty `phone` is P36's finding
 * and an empty `city` is P40's — this rule tests `email` and reports against
 * `email` (1.1.5).
 */

/**
 * True when the cell holds no address: absent, empty, or nothing but
 * whitespace.
 *
 * Trimming is what folds the three cases into one. A tab and a run of spaces
 * are as empty as `''` to the human who opens the row and to every automation
 * that tried to send to it, and a rule that reported the one and not the other
 * would leave a contactable-looking row with no rule at all.
 */
function isMissing(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const p15: CatalogueRule = {
  ruleId: 'P15',
  version: 1,
  ruleName: 'Patient email is empty',
  description:
    'This patient row has no email address — the column is empty, or holds nothing but ' +
    'whitespace. The column is the primary contact and was also used as a login, so ' +
    'nothing can be sent to this person and nobody can sign in as them. The address is ' +
    'nowhere else in the row either: a name, a date of birth or a phone number identifies ' +
    'someone without saying where their post goes, so it has to come from a human or from ' +
    'a source outside this export.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every row with no
   * address (1.1.14). Tests `email` and reports against `email` (1.1.5), so a
   * row whose human has put an address in the column stops matching the next
   * time the rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.email;

      // A cell with any content in it is this rule's business no further.
      // Padding and capitals are P10's fix, a misspelt provider is P11's, a
      // value that is not an address is P12's finding, two addresses in one
      // cell are P13's and a placeholder is P14's — each its own rule and its
      // own approval (1.1.4).
      if (!isMissing(previous)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `email`, so the
        // id is only the address of the row — whatever is wrong with the id
        // itself belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'email',
        // Reported verbatim, so an absent address, an empty one and a cell with
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
