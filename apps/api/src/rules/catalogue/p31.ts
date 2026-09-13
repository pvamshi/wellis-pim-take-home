import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P31 — a patient's `phone` written with the international call prefix spelled
 * out as `00` instead of `+`: `"0031612345678"`, `"0032475123456"`,
 * `"0049301234567"`. The proposal is the same number with that `00` replaced by
 * a `+`, so the country code it already carries is written the way every system
 * downstream expects to read one.
 *
 * `00` and `+` are the same instruction written two ways. `00` is what a caller
 * in the Netherlands dials to get an outside line before a country code; `+` is
 * the notation E.164 uses for "whatever the local exit prefix is, here comes a
 * country code". The number after them is identical — `"0031612345678"` and
 * `"+31612345678"` reach the same handset — but the exit prefix is a local
 * habit and not part of the number, so a cell holding one is a number written
 * for a dialler in one country rather than a number any system can store,
 * compare or hand to a telephony provider.
 *
 * Not ambiguous. Nothing is guessed: the `00` is not part of the subscriber's
 * number, the digits after it are already the country code and the number, and
 * the fix leaves every one of those digits where it found them. This is the
 * notation changing, not the number.
 *
 * **What counts as `00` followed by a country code.** A country calling code
 * never begins with `0` — that slot is what trunk and exit prefixes use, which
 * is exactly why `00` can be told apart from the number at all — so the test is
 * the shape the catalogue names: `00`, then a digit that is `1` to `9`, then
 * whatever else the cell holds. That first non-zero digit is what makes the
 * `00` an exit prefix rather than the start of the digits, and it is checkable
 * from the cell without any list.
 *
 * A list of assigned country codes was deliberately not used. The fix here is
 * how the prefix is written, not whether the country on the other end exists,
 * and a list that is missing a code would refuse to fix a real number — a
 * silent non-fix on good data, which is worse than leaving a doubtful code for
 * the rules that ask about the number itself.
 *
 * **The cell must already be bare digits.** `"00 31 6 1234 5678"`,
 * `"0031-6-12345678"`, `"  0031612345678  "` are all this number with grouping
 * or padding still on them, and taking that out is P30's fix, not this one. A
 * rule that both stripped the grouping and rewrote the prefix would be two
 * fixes in one (1.1.4), and it would hide P30's finding from the human who
 * would otherwise see it. P30 cleans the cell, and on the next run this rule
 * reads the digits it left and proposes the `+`. Seven rules read this column
 * and each does one thing to it.
 *
 * Left whole for the same reason:
 *
 * - **A cell that already has a `+`.** `"+31612345678"` is the value this rule
 *   produces; there is nothing to propose. `"+0031612345678"` carries both
 *   notations at once, which is a cell nobody can read as one number — that is
 *   a question for the column's ambiguous rules, not a prefix to rewrite.
 * - **A third zero.** `"000000000"`, `"0001234567"`. No country code starts
 *   with `0`, so what follows the `00` here is not one, and this is the shape
 *   the catalogue gives P35 as a placeholder. Proposing `"+0000000"` would be
 *   turning junk into a number that looks real.
 * - **Anything that is not a digit.** A letter, an extension, a slash, a
 *   comma. Those cells go to P30 or P34 as they stand, and never through a
 *   prefix rewrite that would quietly carry the stray character along.
 * - **A number with no `00` in front of it.** `"0612345678"` is the national
 *   Dutch spelling, and giving it its `+31` is P32's fix — a different rule
 *   because it is a different decision: P32 has to know which country the
 *   number is from, and this rule is told by the cell.
 *
 * **What the digits add up to is not this rule's business.** `"0031612"` is too
 * short to be anybody's number and still becomes `"+31612"`: the prefix is
 * wrong whatever the length, and the length is P33's finding and P33's sentence
 * to a human. `"00310612345678"` keeps the trunk zero the international form
 * does not need — dropping it would be a second fix and a decision about which
 * number the cell meant — and the result being too long is, again, P33's. This
 * is the line P30 drew on this column and P26 drew on `bsn`: fix the one thing,
 * and leave what the digits add up to to the rule that asks.
 *
 * The column is read and the same column is proposed against (1.1.5), and what
 * is proposed starts with a `+` rather than `00`, so an approved row does not
 * match the next time the rules run.
 */

/**
 * A cell holding nothing but digits — no `+`, no grouping, no padding, no
 * letters. This is what P30 leaves behind, and this rule only reads cells that
 * have got that far, so that removing grouping and rewriting the prefix stay
 * two findings a human sees separately (1.1.4).
 */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * The exit prefix and the start of a country code: `00`, then a digit that is
 * not another zero. A country calling code never begins with `0`, so that digit
 * is what separates "an exit prefix in front of a country code" from "a number
 * that happens to start with zeroes" — a placeholder like `"000000000"`, which
 * is P35's finding and not a number to rewrite.
 */
const EXIT_PREFIX_THEN_COUNTRY_CODE = /^00[1-9]/;

export const p31: CatalogueRule = {
  ruleId: 'P31',
  version: 1,
  ruleName: 'Patient phone starts 00 in front of a country code',
  description:
    "This patient's phone number is written with the international call prefix spelled " +
    'out as 00 — the digits somebody dials in the Netherlands to get an outside line — in ' +
    'front of the country code. The same number is proposed with that 00 replaced by a +, ' +
    'which is how a country code is written when the number has to be stored, compared or ' +
    'dialled from anywhere: +31 6 … rather than 0031 6 …. Every digit of the number after ' +
    'the prefix is left exactly as it is, and whether the number is the right length is ' +
    'left to the rule that asks that.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every phone number
   * that would change (1.1.14). Tests `phone` and changes `phone` (1.1.5), and
   * what it proposes starts with a `+`, so an approved row stops matching the
   * next time the rules run.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.phone;

      // No value in the column at all. There is no prefix here to rewrite, and
      // a row with no phone number is P36's empty finding.
      if (previous === null) {
        continue;
      }

      // Not yet bare digits: grouping, padding, a `+`, a letter, an extension,
      // a stray mark. Those cells belong to P30 and P34 as they stand — this
      // rule reads what P30 leaves behind, so that cleaning the cell and
      // rewriting the prefix stay two findings (1.1.4).
      if (!DIGITS_ONLY.test(previous)) {
        continue;
      }

      // Either no `00` in front at all — a national number, which is P32's fix
      // — or a third zero after it, which is not a country code and is the
      // shape P35 reports as a placeholder.
      if (!EXIT_PREFIX_THEN_COUNTRY_CODE.test(previous)) {
        continue;
      }

      // The `00` out, a `+` in, and the country code and the number after it
      // carried across digit for digit.
      const next = `+${previous.slice(2)}`;

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
        // The same number with the exit prefix written as `+`.
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
