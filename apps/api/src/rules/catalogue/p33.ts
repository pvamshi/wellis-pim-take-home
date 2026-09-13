import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P33 — a patient's `phone` holding a count of digits that is not a phone
 * number's: too few, or too many — `"123"`, `"61234"`, `"1234567890123456"`,
 * `"+31612"`, `"+310612345678"`, `"+3161234567"`.
 *
 * The export notes say this column's "format never enforced", and a column
 * nobody enforced collects half a number as easily as a whole one. A digit gets
 * dropped when a cell is retyped. A digit gets doubled when a key sticks. Two
 * numbers get pasted into one cell and the result is twice as long as anything
 * dialable. A fragment gets typed while somebody is reading the rest of it off
 * a form, and nobody comes back to finish it. None of those is visible from the
 * look of the cell — `"+31612345"` reads like a phone number until the digits
 * are counted — which is why counting them is a rule of its own.
 *
 * Ambiguous, and nothing could make it otherwise. The missing digits are not in
 * the cell and the extra ones cannot be told apart from the real ones: a number
 * one digit short is nine numbers, one for each digit that might have gone and
 * each place it might have sat, and a number one digit long is as many again.
 * A phone number is not derived from anything either — no combination of a
 * name, a date of birth and a city spells one, so nothing else in the row holds
 * the answer, and reading another column to write this one would break 1.1.5
 * as well. A proposal here would be an invented number, and an invented number
 * of the right length rings on somebody's handset: this patient's appointment
 * reminder goes to a stranger. So the rule reports and proposes nothing
 * (1.1.12), and its description is the whole of what the human reads.
 *
 * **What the bounds are, and where they come from.**
 *
 * - **At most fifteen digits.** E.164 fixes the maximum length of an
 *   international telephone number at fifteen digits, country code included.
 *   This is not a judgement about plausibility — a sixteenth digit cannot be
 *   carried by the numbering plan at all, so a longer cell is not a number
 *   anywhere on earth.
 * - **At least seven digits.** There is no standard minimum, so this is the
 *   shortest complete number actually in use: the small territories with
 *   four-digit subscriber numbers — Saint Helena's `+290 xxxx`, Niue's
 *   `+683 xxxx` — reach seven once the country code is counted. Below that a
 *   cell is a fragment, an extension, a short code or a number somebody started
 *   typing, and not a patient's own telephone number.
 * - **A number that says `+31` is eleven digits.** A Dutch number is nine
 *   digits once the trunk zero is off it — `6 12345678` for a mobile,
 *   `20 1234567` in Amsterdam — so `+31` and nine digits is eleven, and a cell
 *   claiming the Netherlands with any other count cannot be dialled. This is
 *   the one place the rule reads the country code rather than only counting,
 *   and it is here because the cell says which plan it belongs to: nothing is
 *   assumed about where the number is from, the number states it.
 *
 * **Only the Netherlands, and deliberately so.** A table of the world's number
 * plans is exactly what P31 refused when it declined to check its country code
 * against a list, and for the same reason: a table that is missing or wrong
 * about a plan reports a real number as impossible, and every entry in it is
 * another thing to keep current. The Dutch plan is the one this export is
 * written in — it is a Dutch clinic's patient file, and P32 writes `+31` onto
 * this very column — so it is the one plan the rule can claim to know. Every
 * other country code is measured by the universal bounds alone: `+32475123456`
 * and `+4930123456789` pass, and whether they are right for Belgium or Germany
 * is not a question this rule pretends to answer.
 *
 * **This is the rule the other phone rules hand their lengths to**, and each of
 * them says so:
 *
 * - P30 cleans `"+31 (0)6 12345678"` to `"+310612345678"`, keeping the
 *   bracketed trunk zero because taking it out would be a second fix. That is
 *   twelve digits on a `+31` number, and this is the rule that puts it in front
 *   of a human.
 * - P31 rewrites `"00310612345678"` to `"+310612345678"` and `"0031612"` to
 *   `"+31612"`, carrying every digit across whatever they add up to. Twelve and
 *   five, and both arrive here.
 * - P32 rewrites `"061234567"` — a Dutch number a digit short — to
 *   `"+3161234567"`. Ten digits, and this is where being a digit short is said
 *   out loud.
 *
 * That is what "one rule, one fix" (1.1.4) costs and buys: four rules touch
 * `"+31 (0)6 12345678"` in turn, and each one's finding is a separate thing a
 * human can see and judge, rather than one rule silently deciding which of two
 * numbers the cell meant.
 *
 * **The cell must already be bare digits, with at most a leading `+`.** That is
 * what P30 leaves behind, and it is what makes a count mean anything: counting
 * the digits in `"06 12 34 56 78"` would be counting a number that still has
 * its grouping on it, and counting `"06-12345678 ext 12"` would be counting an
 * extension as part of the number. Grouping and padding are P30's fix, and
 * letters, extensions and stray marks are P34's finding. Both of those cells
 * are left exactly as they stand.
 *
 * Left alone for the same reason — the cell has a fix coming and its length is
 * not settled until that fix lands:
 *
 * - **`00` then a country code.** P31 replaces two digits with a `+`, so the
 *   count this rule would take now is two digits longer than the one the cell
 *   keeps. `"00312"` is measured on the next run, as `"+31612"`'s five.
 * - **One leading zero then a number.** P32 replaces the trunk zero with `+31`,
 *   so the count changes by one in the other direction. `"0123"` is not
 *   measured as four digits here; it is measured after P32 has written what the
 *   national form left implied.
 * - **A run of one digit.** `"000000000"`, `"1111111111111111"`, `"0"`. The
 *   catalogue gives P35 "all one digit" in as many words, and a placeholder is
 *   a placeholder whether it happens to be nine digits long or twenty. Counting
 *   it here as well would put two ambiguous findings on one cell in one batch
 *   for a human to choose between (1.1.4), and the count is not what is wrong
 *   with it.
 * - **A cell with nothing in it.** `null` and `''` are P36's empty finding.
 *
 * **The count is the whole of the question.** Whether those digits are somebody
 * real, whether the area code exists, whether the number is still connected —
 * none of that is checkable from the cell, and none of it is claimed. Eleven
 * digits starting `+31` pass here even if no such number was ever issued. This
 * is the same line P28 draws on `bsn`, where the checksum is the question and
 * whose number it is is not.
 *
 * The column is read and the same column is reported against (1.1.5), which is
 * what makes the rule self-terminating: a human writes the whole number into
 * the cell the rule read — or empties it, which is then P36's ordinary empty
 * finding rather than this one — and the row stops matching.
 */

/**
 * A cell holding digits, with a single `+` allowed in front of them and nowhere
 * else. This is the shape P30 leaves behind, and this rule only counts cells
 * that have got that far: a cell with grouping still on it, or a letter, an
 * extension or a stray mark in it, holds no count worth taking and belongs to
 * P30 or P34 as it stands.
 */
const DIGITS_WITH_OPTIONAL_LEADING_PLUS = /^\+?[0-9]+$/;

/**
 * The international exit prefix in front of a country code — P31's fix, which
 * takes two digits out of the cell and puts a `+` there instead. The count is
 * not settled until it has.
 */
const EXIT_PREFIX_THEN_COUNTRY_CODE = /^00[1-9]/;

/**
 * The national trunk zero in front of a number — P32's fix, which takes one
 * digit out and puts the two of `+31` in. The count is not settled until it
 * has, and in the other direction.
 */
const TRUNK_ZERO_THEN_NUMBER = /^0[1-9]/;

/**
 * One digit, repeated for the whole cell: `"0"`, `"000000000"`,
 * `"1111111111111111"`. The catalogue's "all one digit", which is P35's
 * placeholder and not a length to count.
 */
const ONE_DIGIT_REPEATED = /^([0-9])\1*$/;

/**
 * E.164's maximum: fifteen digits, country code included. A sixteenth digit is
 * not carried by the numbering plan, so a longer cell is not a phone number
 * anywhere.
 */
const LONGEST_ANY_NUMBER = 15;

/**
 * The shortest complete number in use anywhere: a three-digit country code and
 * a four-digit subscriber number, as in Saint Helena's `+290 xxxx`. There is no
 * standard minimum, so this is the floor taken from what exists.
 */
const SHORTEST_ANY_NUMBER = 7;

/** The country code this export's own numbers carry, as P32 writes it. */
const NETHERLANDS = '+31';

/**
 * `+31`'s two digits and the nine a Dutch national significant number has, so
 * eleven: `+31 6 12345678`, `+31 20 1234567`.
 */
const DUTCH_NUMBER_DIGITS = 11;

/** The cell's digits — everything but a leading `+`, which is notation. */
function digitsOf(value: string): string {
  return value.startsWith('+') ? value.slice(1) : value;
}

/**
 * Whether this many digits could be a telephone number at all.
 *
 * A cell that names the Netherlands is measured against the Dutch plan, because
 * it has said which plan it belongs to. Every other cell is measured against
 * the universal bounds only — no table of the world's number plans, for the
 * reason P31 gave when it refused one.
 */
function isPossibleLength(value: string, digits: string): boolean {
  if (value.startsWith(NETHERLANDS)) {
    return digits.length === DUTCH_NUMBER_DIGITS;
  }

  return digits.length >= SHORTEST_ANY_NUMBER && digits.length <= LONGEST_ANY_NUMBER;
}

export const p33: CatalogueRule = {
  ruleId: 'P33',
  version: 1,
  ruleName: 'Patient phone has too few or too many digits to be a phone number',
  description:
    "This patient's phone number has the wrong number of digits in it to be a telephone " +
    'number at all. A number is at most fifteen digits long once the country code is ' +
    'counted — the international limit every network works to — and the shortest complete ' +
    'number anywhere in the world is seven, so a cell holding three digits, or twenty-two, ' +
    'is not a number anyone can dial. A number that names the Netherlands is checked ' +
    'against the Dutch plan instead: a Dutch number is nine digits after the country code, ' +
    'so +31 followed by anything but nine digits — a trunk zero left in front of the ' +
    'number, a digit mistyped, doubled or missed out, half a number typed and never ' +
    'finished — cannot be dialled either. Nothing is proposed, because the missing digits ' +
    'are not in the cell and the extra ones cannot be told from the real ones: a number ' +
    'invented to make the count come out would be the right length and would ring on a ' +
    "stranger's handset. A human finds the real number — from the patient, the intake or " +
    'the appointment notes — and writes it in, or empties the cell if there never was one.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every `phone` whose
   * digits cannot be a telephone number's (1.1.14). Tests `phone` and reports
   * against `phone` (1.1.5), so a row whose human has written the whole number
   * — or cleared the cell — stops matching the next time the rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.phone;

      // No value in the column at all. There are no digits here to count, and a
      // row with no phone number is P36's empty finding.
      if (previous === null) {
        continue;
      }

      // Not digits with at most a leading `+`: grouping, padding, a letter, an
      // extension, a stray mark, a `+` in the middle. Counting those would be
      // counting the typist's spacing or an extension as part of the number, so
      // the cell goes to P30 and P34 exactly as it stands.
      if (!DIGITS_WITH_OPTIONAL_LEADING_PLUS.test(previous)) {
        continue;
      }

      // P31 replaces the `00` with a `+`, two digits gone; P32 replaces the
      // trunk zero with `+31`, one digit gone and two written. Either way the
      // count this rule would take now is not the count the cell keeps, so the
      // measuring waits for the run after the fix.
      if (EXIT_PREFIX_THEN_COUNTRY_CODE.test(previous) || TRUNK_ZERO_THEN_NUMBER.test(previous)) {
        continue;
      }

      const digits = digitsOf(previous);

      // One digit repeated for the whole cell — the catalogue's "all one digit",
      // which is P35's placeholder. What is wrong with it is that nobody typed a
      // number, not how many times they typed the same key, and two ambiguous
      // findings on one cell in one batch is what 1.1.4 avoids.
      if (ONE_DIGIT_REPEATED.test(digits)) {
        continue;
      }

      // A count a telephone number can have. Whether these particular digits are
      // anybody's number is not checkable from the cell and is not claimed.
      if (isPossibleLength(previous, digits)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `phone`, so the
        // id is only the address of the row — whatever is wrong with the id
        // itself belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'phone',
        // Reported exactly as stored, so the human sees the cell they would see
        // in the row and can count the digits for themselves.
        prev: previous,
        // No value is proposed, and none can be (1.1.12).
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
