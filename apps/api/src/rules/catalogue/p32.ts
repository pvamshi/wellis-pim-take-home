import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P32 — a patient's `phone` written the way it is written at home in the
 * Netherlands: the national trunk zero in front, and no country code at all —
 * `"0612345678"`, `"0201234567"`, `"0791234567"`. The proposal is the same
 * number in `+31` form: the trunk zero replaced by the country code, so
 * `"0612345678"` becomes `"+31612345678"`.
 *
 * The trunk zero is not part of the number. It is what a caller inside the
 * Netherlands dials to reach the national network before the area or mobile
 * code — the domestic counterpart of the `00` P31 reads — and it is dropped the
 * moment the number is dialled from anywhere else. A cell holding one is a
 * number written for a dialler standing in this country: it cannot be dialled
 * from outside it, it cannot be compared against the same person's number held
 * as `+31…` by another system, and a telephony provider handed it has no way to
 * know which country's trunk network the zero refers to. `+31` says the thing
 * the zero leaves the reader to assume.
 *
 * Not ambiguous. The catalogue does not mark it, and the reason is that the
 * cell says which country it is from once the file it sits in is taken into
 * account: this is a Dutch clinic's patient export, the trunk zero is the Dutch
 * national spelling, and `06` in particular is the Dutch mobile prefix every
 * person in the country writes their own number with. No digit is guessed —
 * every digit after the zero is carried across in order, and the only thing
 * added is the country code the national form leaves implied.
 *
 * **`06` and `0` are one shape, not two.** The catalogue names `06` first
 * because mobile numbers are most of this column, but `06` is just the
 * commonest spelling of the thing the rule reads: one leading zero, then the
 * number. `"0201234567"` in Amsterdam and `"0101234567"` in Rotterdam are the
 * same cell wanting the same fix, and splitting mobile from landline would be two
 * rules doing one fix (1.1.4) with a seam down the middle for every area code
 * somebody forgot to list.
 *
 * **One zero, and the digit after it is not another zero.** `"00…"` is the
 * international exit prefix in front of a country code, which is P31's fix and
 * an entirely different reading of the cell: the `0032…` in the export notes is
 * a Belgian number, not a Dutch one, and a rule that treated its leading zero
 * as a trunk zero would propose `"+310032475123456"` — the mistake the phone
 * rules were split apart to avoid. So the shape tested here is `0`, then a
 * digit that is `1` to `9`, then the rest of the cell. That second digit is
 * what separates a trunk zero from an exit prefix, and it is checkable from the
 * cell without any list.
 *
 * **The cell must already be bare digits.** `"06 12 34 56 78"`, `"06-12345678"`
 * and `"  0612345678  "` are this number with grouping or padding still on
 * them; taking that out is P30's fix. A rule that both stripped the grouping
 * and added the country code would be two fixes in one (1.1.4) and would hide
 * P30's finding from the human who would otherwise see it. P30 cleans the cell,
 * and on the next run this rule reads the digits it left.
 *
 * Left whole for the same reason:
 *
 * - **A cell that already has a `+`.** `"+31612345678"` is the value this rule
 *   produces, and `"+32475123456"` is a number that already says which country
 *   it is from. There is nothing implied left to write out.
 * - **A number with no leading zero.** `"612345678"`, `"31612345678"`,
 *   `"201234567"`. The catalogue's shape is a number *starting* `0`, and a cell
 *   without one is not the national spelling: adding `+31` to it would mean
 *   deciding whether the digits are a number missing its trunk zero, a country
 *   code missing its `+`, or something else again. Those cells go to P33 and
 *   the column's other ambiguous rules as they stand.
 * - **Anything that is not a digit.** A letter, an extension, a slash, a
 *   comma, a `+` in the middle. Those cells are P30's or P34's whole, and never
 *   go through a prefix rewrite that would carry a stray character along.
 *
 * **What the digits add up to is not this rule's business.** A Dutch national
 * number is ten digits and `"061234567"` is nine, but the trunk zero is still a
 * trunk zero and the number is still missing its country code, so it becomes
 * `"+3161234567"` and being too short is P33's finding and P33's sentence to a
 * human. Refusing to fix anything but an exactly-ten-digit cell would be a
 * silent non-fix on a real number — the same trap P31 refused when it declined
 * to check its country code against a list. This is the line P30 drew on this
 * column and P26 drew on `bsn`: fix the one thing, and leave what the digits
 * add up to to the rule that asks.
 *
 * The column is read and the same column is proposed against (1.1.5), and what
 * is proposed starts with `+31` rather than a zero, so an approved row does not
 * match the next time the rules run.
 */

/**
 * A cell holding nothing but digits — no `+`, no grouping, no padding, no
 * letters. This is what P30 leaves behind, and this rule only reads cells that
 * have got that far, so that cleaning the cell and writing out the country code
 * stay two findings a human sees separately (1.1.4).
 */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * The national trunk prefix and the start of the number: one `0`, then a digit
 * that is not another zero. A second zero means `00`, the international exit
 * prefix, which is P31's country code and not this rule's trunk zero — and a
 * run of zeroes is the placeholder shape P35 reports.
 */
const TRUNK_ZERO_THEN_NUMBER = /^0[1-9]/;

/** The country code the national form leaves implied. */
const NETHERLANDS = '+31';

export const p32: CatalogueRule = {
  ruleId: 'P32',
  version: 1,
  ruleName: 'Patient phone is a national Dutch number with no country code',
  description:
    "This patient's phone number is written the way it is written inside the Netherlands — " +
    'a leading 0 and no country code, as in 06 12345678 for a mobile or 020 … for an ' +
    'Amsterdam landline. That leading 0 is the national trunk prefix, dialled only from ' +
    'inside the country and dropped everywhere else, so the number cannot be dialled from ' +
    'abroad or matched against the same number held as +31 by another system. The +31 form ' +
    'is proposed: the 0 replaced by the country code, every remaining digit kept in the ' +
    'order the cell had it. Whether the number is the right length is left to the rule ' +
    'that asks that.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every phone number
   * that would change (1.1.14). Tests `phone` and changes `phone` (1.1.5), and
   * what it proposes starts with `+31`, so an approved row stops matching the
   * next time the rules run.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.phone;

      // No value in the column at all. There is no number here to give a
      // country code to, and a row with no phone number is P36's empty finding.
      if (previous === null) {
        continue;
      }

      // Not yet bare digits: grouping, padding, a `+`, a letter, an extension,
      // a stray mark. Those cells belong to P30 and P34 as they stand — this
      // rule reads what P30 leaves behind, so that cleaning the cell and
      // writing out the country code stay two findings (1.1.4).
      if (!DIGITS_ONLY.test(previous)) {
        continue;
      }

      // Either no leading zero at all — not the national spelling, and not a
      // cell to guess a country code onto — or a second zero, which makes the
      // front an international exit prefix (P31's fix) or a run of zeroes
      // (P35's placeholder), never a trunk zero.
      if (!TRUNK_ZERO_THEN_NUMBER.test(previous)) {
        continue;
      }

      // The trunk zero out, the country code it implied in, and the number
      // after it carried across digit for digit.
      const next = `${NETHERLANDS}${previous.slice(1)}`;

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `phone`, so the
        // id is only the address of the row — whatever is wrong with the id
        // itself belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'phone',
        // Reported exactly as stored, so a human comparing the two sees the
        // cell they would see in the row.
        prev: previous,
        // The same number with the country code written out in place of the
        // trunk zero.
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
