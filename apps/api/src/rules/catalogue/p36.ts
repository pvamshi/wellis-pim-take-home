import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P36 — a patient row with no `phone` at all: the column absent, the cell
 * empty, or the cell holding nothing but whitespace.
 *
 * The export notes call this column the contact number and say its "format
 * never enforced". A column nobody enforced collects blanks along with
 * everything else: the question was asked and skipped, the patient had no
 * number to give, the automation that wrote the row never carried one across.
 * The cost is the plain one — there is no way to telephone this patient. That
 * matters on its own and it matters twice over here, because `email` is the
 * only other route to them and P12 through P15 exist because that column is a
 * mess of its own: a row whose email bounces and whose phone is blank is a
 * patient nobody can reach at all.
 *
 * An empty cell is the honest version of what P33, P34 and P35 report. Those
 * three cells claim to hold a number and do not — too few digits, a word, a
 * swept keypad — and this one claims nothing. The finding is the same missing
 * number, and the sentence a human reads about it is different, which is why it
 * is a rule of its own (1.1.4). Without it an empty phone would have no rule at
 * all: every other rule on this column is written about a value, and all six
 * step over a cell that has none.
 *
 * Ambiguous, and nothing could make it otherwise:
 *
 * - **A telephone number is not derivable from anything else in the row.**
 *   `full_name`, `dob`, `bsn` and `city` identify a person without saying where
 *   they can be called, and `email` is a different channel rather than a number
 *   kept in another column. Leaning on any of them would also break 1.1.5,
 *   which is what stops a rule reading one column and writing another.
 * - **A number invented to fill the cell rings on a stranger's handset.** This
 *   is the harm P33, P34 and P35 each refuse from their own side, arrived at
 *   here from the emptiest one: a proposal of the right shape would be dialled,
 *   and this patient's appointment reminder would go to whoever owns it.
 * - **The blank may be the truthful answer.** Some of these rows are somebody
 *   who has no telephone, or who was never asked for one. The resolution for
 *   those is to leave the column as it stands and record that the question was
 *   put — not a value this rule could propose either, and not a judgement it
 *   can make.
 *
 * So this rule reports and proposes nothing (1.1.12), and its description is
 * the whole of what the human reads. What resolves the row is a person who can
 * find the number — from the intake, the appointment notes, or by asking the
 * patient — and writing it in, or deciding the blank is correct and declining
 * the finding.
 *
 * Three ways a cell arrives with no number in it, and all three are this
 * rule's:
 *
 * - `null`, because `phone` is nullable and a row whose source had no such
 *   column lands that way.
 * - `''`, an empty cell in `patients.csv`.
 * - whitespace only, a cell somebody typed a space or a tab into.
 *
 * The last one is a handoff and not this rule widening itself. P30 removes the
 * grouping it names and then stops short of the cell that was *only* grouping —
 * `"   "` cleans away to nothing, and a rule whose fix is "the digits" cannot
 * propose a number with none in it. P33, P34 and P35 all read cells with
 * something in them: three spaces hold no digits to count, no letter to report
 * and nothing pretending to be a number. One of the seven rules on this column
 * has to own a cell of three spaces, and it is this one, because to everybody
 * who opens the row that cell is blank.
 *
 * Every cell with something in it is walked past here, whatever is wrong with
 * that something, and whose it is:
 *
 * - **A number that can be dialled** — nothing to report, which is what the
 *   column is for.
 * - **Grouping or padding around a number** — P30's fix. `"  06 12 34 56 78 "`
 *   holds a number; it is untidy, not absent.
 * - **`00` in front of a country code** — P31's fix.
 * - **A national Dutch number with no country code** — P32's fix.
 * - **Too few or too many digits** — P33's finding. `"06123"` is a number not
 *   finished, which is not the same as a number not given.
 * - **Letters, a word, an extension** — P34's finding. `"geen"` and
 *   `"onbekend"` are somebody writing "there isn't one" in the box, and P34's
 *   sentence about that is the true one: there is text in the cell to take out.
 * - **A placeholder** — P35's finding, the cell pretending not to be empty.
 * - **A mark somebody typed instead of a number** — `"-"`, `"()"`, `"+"`,
 *   `"?"`. These look like nothing to a reader and they are somebody declining
 *   to answer, but they are characters in the cell, and this rule reports an
 *   absence rather than reading what a mark was meant to mean. Sweeping them in
 *   here would be deciding on our own which marks count as empty, which is a
 *   guess, and it would put two findings under one id (1.1.4).
 *
 * The column is only read, and only this one. An empty `email` is P15's
 * finding, an empty `sex` P25's and an empty `city` P40's — this rule tests
 * `phone` and reports against `phone` (1.1.5), which is also what makes it
 * self-terminating: the human writes the number they found into the column the
 * rule read, and the row stops matching.
 */

/**
 * True when the cell holds no number: absent, empty, or nothing but whitespace.
 *
 * Trimming is what folds the three cases into one. A tab and a run of spaces
 * are as empty as `''` to the human who opens the row and to anybody trying to
 * telephone the patient, and every other rule on this column has already
 * stepped over all three — a rule that reported the one and not the other would
 * leave a blank-looking phone with no rule at all.
 */
function isMissing(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const p36: CatalogueRule = {
  ruleId: 'P36',
  version: 1,
  ruleName: 'Patient phone is empty',
  description:
    'This patient row has no phone number — the column is empty, or holds nothing but ' +
    'whitespace. The old form never enforced anything about this column, so a number that ' +
    'was never asked for, never given, or lost on the way into the export simply left the ' +
    'cell blank. There is no way to telephone this patient, and email is the only other ' +
    'route to them. The number is nowhere else in the row either: a name, a date of birth ' +
    'and a city identify someone without saying where they can be called, and an email ' +
    'address is a different channel, not a number in another column. Nothing is proposed, ' +
    'because a number invented to fill the cell would be the right shape and would ring on ' +
    "a stranger's handset — this patient's appointment reminder would go to them. A human " +
    'finds the real number, from the intake, the appointment notes or the patient, and ' +
    'writes it in; or decides this person has no telephone and leaves the cell as it is.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every row with no
   * phone number in it (1.1.14). Tests `phone` and reports against `phone`
   * (1.1.5), so a row whose human has written the number they found stops
   * matching the next time the rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.phone;

      // A cell with any content in it is this rule's business no further.
      // Grouping and padding are P30's fix, a `00` prefix is P31's, a national
      // Dutch number is P32's, a count no number has is P33's finding, letters
      // and extensions are P34's and a placeholder is P35's — each its own rule
      // and its own approval (1.1.4). A mark typed instead of a number is a
      // character in the cell, not an absence, so it is not swept in here
      // either.
      if (!isMissing(previous)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `phone`, so the
        // id is only the address of the row — whatever is wrong with the id
        // itself belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'phone',
        // Reported verbatim, so an absent number, an empty cell and a cell with
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
