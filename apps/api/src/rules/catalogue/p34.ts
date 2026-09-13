import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P34 — a patient's `phone` with letters in it: an extension written after the
 * number, a word instead of a number, a note left beside one — `"06-12345678
 * ext 12"`, `"0612345678 tst"`, `"020 1234567 toestel 3"`, `"onbekend"`,
 * `"geen"`, `"06123456X8"`, `"+31612345678 (werk)"`.
 *
 * The export notes say this column's "format never enforced", and a free-text
 * box that takes a phone number takes prose just as happily. Somebody with a
 * switchboard number types the extension after it, because that is how the
 * number is actually dialled. Somebody who has no number writes that down in
 * words rather than leaving the cell blank. Somebody records whose phone it is
 * — `(werk)`, `(moeder)` — because there was nowhere else to put it. And a
 * letter lands among the digits when a hand slips a key. None of those cells
 * holds a number anything downstream can dial or compare, and none of them can
 * be turned into one by reading the cell harder.
 *
 * Ambiguous, and there is nothing that could make it otherwise:
 *
 * - **Deleting the letters throws away part of the answer.** `"0201234567 ext
 *   12"` is not a number with rubbish stuck to it. The extension is a second
 *   number, dialled after the first one connects, and it is how this patient is
 *   actually reached at that switchboard. A rule that proposed `"0201234567"`
 *   would be proposing a number that rings a reception desk, and it would be
 *   throwing the part that finds the patient away silently, in a proposal that
 *   looks like a tidy-up.
 * - **Keeping the digits either side is worse.** Run them together and
 *   `"0201234567 ext 12"` becomes `"020123456712"`, which is not a number
 *   anybody has — it is the mistake P30 was written never to make, and it would
 *   arrive downstream looking exactly like a phone number.
 * - **A word is not a number at all.** `"onbekend"`, `"geen"`, `"n.v.t."` hold
 *   no digits to keep. They are somebody writing "there isn't one", and the
 *   resolution for those is taking the text out rather than finding a number —
 *   which is a decision about a person's record, not a transformation.
 * - **A letter among the digits gives no clue what it replaced.** `"06123456X8"`
 *   is nine digits and a letter; which digit the `X` was typed over, and
 *   whether it was typed over one at all, is not in the cell. A phone number is
 *   not derived from anything else in the row either — no combination of a
 *   name, a date of birth and a city spells one — so nothing else here holds
 *   the answer, and reading another column to write this one would break 1.1.5
 *   as well.
 *
 * An invented number of the right shape is the harm all four share: it rings on
 * a stranger's handset, and this patient's appointment reminder goes to them. So
 * the rule reports and proposes nothing (1.1.12), and its description is the
 * whole of what the human reads.
 *
 * **Both halves of the catalogue entry are one test.** "Contains letters" and
 * "an extension" are two ways into the same finding, and the first covers the
 * second: an extension is written with a word in front of it — `ext`, `ext.`,
 * `x`, `tst`, `toestel`, `doorkiesnummer` — because a bare number after a
 * number would not be readable as an extension by the person typing it either.
 * The test is therefore stated once, as "a letter anywhere in the cell", and an
 * extension, a word, a note and a slipped key all fail it the same way. Every
 * cell that fails gets one finding under one id, however many ways it fails
 * (1.1.4).
 *
 * **A trailing group of digits is not read as an extension**, and deliberately
 * not. `"0201234567 12"` and `"0201234567-12"` hold nothing that says the `12`
 * is an extension rather than the last group of a number written oddly, or a
 * digit or two typed twice. Deciding between those readings is guessing, and
 * guessing wrong deletes real digits out of a real number. Those cells are
 * grouped digits as far as anything here can tell, so they are P30's to clean
 * and P33's to count, and what the count comes to is what puts them in front of
 * a human.
 *
 * **The cell is tested exactly as it stands, and no rule goes first.** This is
 * the one phone rule that needs nothing cleaned before it can read the cell,
 * because every other rule on this column has already stepped over a cell with
 * a letter in it: P30 removes the grouping it names and then checks that what
 * is left is a phone number's characters, so it walks past `"06-12345678 ext
 * 12"` whole; P31 and P32 read only cells that are already bare digits; P33
 * counts only digits with at most a leading `+`, and says in as many words that
 * letters and extensions are this rule's finding. No cell can carry a P34
 * finding and another phone rule's finding in the same batch, which is what
 * 1.1.4 is protecting.
 *
 * Left alone, for that reason and the same reason as everywhere else on this
 * column:
 *
 * - **Anything without a letter in it.** `"06 12 34 56 78"` is grouping, which
 *   is P30's fix. `"0612345678"` is P32's country code. `"0031612345678"` is
 *   P31's. `"123"` and `"1234567890123456"` are P33's count. `"000000000"` is
 *   P35's placeholder. None of them is a cell somebody wrote words into.
 * - **A stray mark that is not a letter** — `"06/12345678"`, `"0612345678?"`,
 *   `"06+31612345678"`. A slash, a question mark and a misplaced `+` are not
 *   what this catalogue entry names, and each is its own question about what
 *   the cell holds. Reporting them here would be this rule quietly becoming
 *   "anything the other phone rules did not want", which is a rule the
 *   catalogue does not describe.
 * - **A cell with nothing in it.** `null`, `''` and a cell of nothing but
 *   whitespace all read as the same blank to whoever opens the row, and none of
 *   them holds a letter. An empty phone is P36's finding.
 *
 * The column is read and the same column is reported against (1.1.5), which is
 * what makes the rule self-terminating: a human writes the patient's own number
 * into the cell the rule read — or empties it, which is then P36's ordinary
 * empty finding rather than this one — and the row stops matching. A number
 * written back in national form is P32's ordinary proposal on the next run,
 * which is what it should be.
 */

/**
 * A letter, anywhere in the cell, in any script — `\p{L}` under the `u` flag
 * rather than `[A-Za-z]`, because a cell holding `"telefoon onbekend"` and one
 * holding a word in any other alphabet are the same finding, and a rule that
 * read only ASCII would report the first and migrate the second as a phone
 * number.
 *
 * A digit is `\p{N}` and never `\p{L}`, so no number in any notation is caught
 * by this; and the marks a person groups digits with — spaces, dots, dashes,
 * brackets, a `+` — are punctuation, so a grouped number is untouched here and
 * stays P30's.
 */
const LETTER = /\p{L}/u;

export const p34: CatalogueRule = {
  ruleId: 'P34',
  version: 1,
  ruleName: 'Patient phone holds letters, or an extension',
  description:
    "This patient's phone number has letters in it, so it is not a number that can be " +
    'dialled or compared as it stands. The old form never checked this column, so whatever ' +
    'was typed stayed: an extension written after the number, as in "ext 12", "tst" or ' +
    '"toestel 3"; a word meaning there is none, like "onbekend" or "geen"; a note about ' +
    'whose phone it is; or a letter mistyped among the digits. Nothing is proposed, ' +
    'because what to keep cannot be read out of the cell. An extension is a second number ' +
    'dialled after the first one connects — dropping it leaves a number that rings a ' +
    'reception desk instead of this patient, and running the digits either side together ' +
    'makes a number nobody has. A word holds no digits at all, and a letter among the ' +
    'digits gives no clue which digit it was typed over. A human decides: write the ' +
    "patient's own number into the cell, empty it if there never was one, and put an " +
    'extension that has to be kept somewhere this column is not, because this column holds ' +
    'one dialable number.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every `phone` with a
   * letter in it (1.1.14). Tests `phone` and reports against `phone` (1.1.5),
   * so a row whose human has written the real number — or cleared the cell —
   * stops matching the next time the rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.phone;

      // No value in the column at all. There is no text here to read, and a row
      // with no phone number is P36's empty finding.
      if (previous === null) {
        continue;
      }

      // No letter in the cell. Whatever else is wrong with it — grouping, a
      // missing country code, a count no number has, a placeholder, an empty
      // cell — belongs to one of this column's other six rules, and this rule
      // is not the one that catches what they left.
      if (!LETTER.test(previous)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `phone`, so the
        // id is only the address of the row — whatever is wrong with the id
        // itself belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'phone',
        // Reported exactly as stored, words, marks and spacing and all, so the
        // human sees the cell they would see in the row and can judge whether
        // it holds a number with an extension on it or no number at all.
        prev: previous,
        // No value is proposed, and none can be (1.1.12).
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
