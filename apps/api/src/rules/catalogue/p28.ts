import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P28 — a patient's `bsn` holding nine digits that fail the Dutch eleven-proef,
 * the check every real citizen service number satisfies. The number is the
 * right shape and is still not a BSN.
 *
 * The eleven-proef is arithmetic, not a lookup. Take the nine digits, multiply
 * the first by 9, the second by 8, and so on down to the eighth by 2, multiply
 * the ninth by −1, add the nine products, and the total of a real BSN divides
 * by eleven. It is a self-check built into the number so that a digit typed
 * wrong, or two digits swapped, does not silently become somebody else's BSN —
 * which is exactly what a form that never validated would let happen, and the
 * export notes say this one never did: BSNs "were collected for a period for
 * insurance experiments, then the field was hidden from the form; values were
 * never validated". Nothing between that form and this file ever ran this sum,
 * so this is the first time these cells have been asked the question.
 *
 * A cell that fails is one of several things and the sum cannot tell which: a
 * digit mistyped, two digits transposed, a number from a passport or an
 * insurance policy put in the wrong box, or somebody entering nine digits to
 * get past a required field. Each has a different resolution and none is
 * derivable from what is in the cell.
 *
 * Ambiguous, and there is nothing that could make it otherwise:
 *
 * - **The sum says a number is wrong, never what the right one is.** Eleven
 *   different nine-digit numbers pass the check for any eight digits held
 *   fixed, and a failing number sits one edit away from several passing ones.
 *   Proposing the nearest is inventing a citizen service number, and a wrong
 *   BSN that passes the check is worse than one that visibly fails: it belongs
 *   to a real person, and it would be matched against an insurer's records as
 *   this patient.
 * - **Nothing else in the row holds the number.** A BSN appears in no other
 *   column and is derivable from no combination of them — a name, a date of
 *   birth and a city do not encode one. Reading another column and writing this
 *   one would break 1.1.5 as well.
 * - **The right answer may be to empty the cell.** If the number was never this
 *   patient's, the resolution is removing it rather than correcting it, and
 *   that is a decision about a person's record that a human takes.
 *
 * So this rule reports and proposes nothing (1.1.12), and its description is
 * the whole of what the human reads. What resolves a row is somebody who can go
 * back to the patient, the intake, or the insurance paperwork, and either put
 * the real number in or take the wrong one out.
 *
 * **Nine digits, and nothing besides.** The check is defined on nine digits and
 * the cell must be exactly nine ASCII digits with nothing else in it:
 *
 * - **A grouped or padded cell is P26's first.** `"123 456 789"` and
 *   `"  123456789  "` are the same number under punctuation; P26 proposes the
 *   digits alone and this rule reads that on the next run. Doing the sum on a
 *   cell this rule had stripped itself would put two rules' findings on one
 *   cell in one batch for a human to choose between (1.1.4).
 * - **Eight digits are P27's first.** Eight is a leading zero a spreadsheet
 *   ate, and the sum on eight digits is the sum on a different number. P27 pads
 *   it back to nine, and this rule checks the nine.
 * - **Letters, or any other length.** `"onbekend"`, `"1234X6789"`,
 *   `"1234567890"`. There is no sum to do on a cell that is not nine digits;
 *   P29 reports those whole, and a row that failed both rules would be one
 *   problem under two ids.
 * - **Empty and absent cells** hold no digits at all and are walked past for
 *   the same reason — an absent BSN is the wrong length after cleaning, which
 *   is P29's finding, not a failed checksum.
 *
 * **Only the sum, and the whole of the sum.** Every nine-digit cell whose total
 * divides by eleven is left alone, including `"000000000"` — the catalogue's
 * entry is the eleven-proef and that is the question this rule asks. A register
 * has further reasons to reject a number that the arithmetic does not cover,
 * and folding one of them in here would make this rule two rules (1.1.4) and
 * put a finding under this id that its own description does not explain.
 *
 * The column is read and the same column is reported against (1.1.5), which is
 * what makes the rule self-terminating: a human writes the real number into the
 * cell the rule read, and the row stops matching.
 */

/** Exactly nine ASCII digits, and nothing else in the cell. */
const EXACTLY_NINE_DIGITS = /^[0-9]{9}$/;

/**
 * True when nine digits satisfy the eleven-proef.
 *
 * The first eight digits are weighted 9 down to 2 and the ninth by −1; a real
 * BSN's total divides by eleven. The caller has already established that the
 * string is nine digits, so every `Number` here is a digit and the total is an
 * ordinary small integer — no parsing of the cell as a number happens anywhere,
 * which is what keeps a leading zero a digit rather than something dropped.
 */
function passesElevenProef(digits: string): boolean {
  let total = 0;

  for (let position = 0; position < 8; position += 1) {
    total += (9 - position) * Number(digits[position]);
  }

  total -= Number(digits[8]);

  return total % 11 === 0;
}

export const p28: CatalogueRule = {
  ruleId: 'P28',
  version: 1,
  ruleName: 'Patient bsn fails the eleven-proef checksum',
  description:
    "This patient's BSN is nine digits, which is the right shape, but it fails the Dutch " +
    'eleven-proef — the arithmetic check every real citizen service number satisfies, which ' +
    'exists so that a mistyped or transposed digit cannot quietly become the number of ' +
    'another person. The old form never ran this check, so this is the first time the ' +
    'number has been tested. The check says the number is wrong; it cannot say what the ' +
    'right one is. ' +
    'It may be a digit typed wrong, two digits swapped, or a number from another document ' +
    'put in this box, and each of those is corrected differently. Nothing is proposed, ' +
    'because any number this rule invented would either fail the same check or belong to ' +
    'somebody else. A human finds the real number — from the patient, the intake or the ' +
    'insurance paperwork — and writes it in, or takes the wrong one out.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every nine-digit BSN
   * that fails the check (1.1.14). Tests `bsn` and reports against `bsn`
   * (1.1.5), so a row whose human has written the real number stops matching
   * the next time the rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.bsn;

      // No value in the column at all. There are no digits here to check, and a
      // row with no BSN is the wrong length after cleaning, which is P29's.
      if (previous === null) {
        continue;
      }

      // Anything but exactly nine digits, and there is no sum to do. A grouped
      // or padded cell is P26's to clean first, eight digits are P27's to pad
      // first, and a letter or any other length is P29's, reported whole.
      if (!EXACTLY_NINE_DIGITS.test(previous)) {
        continue;
      }

      // A number that satisfies the check is the only thing this rule has
      // nothing to say about. Whether a register would accept it for some
      // reason beyond the arithmetic is not the question the catalogue asks
      // here (1.1.4).
      if (passesElevenProef(previous)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `bsn`, so the id
        // is only the address of the row — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'bsn',
        // Reported exactly as stored, so the human sees the nine digits they
        // would see in the row and can compare them against the paperwork.
        prev: previous,
        // No value is proposed, and none can be (1.1.12).
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
