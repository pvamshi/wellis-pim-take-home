import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P27 — a patient's `bsn` holding eight digits where a BSN has nine, which is
 * the nine-digit number with its leading zero eaten. The proposal is the same
 * digits with the zero put back on the front: `"67077086"` → `"067077086"`.
 *
 * A BSN is nine digits and always has been; eight digits is not a shorter kind
 * of BSN, it is a BSN that went through something that read it as a number.
 * That something is a spreadsheet: open a CSV in one, and a cell of bare digits
 * becomes an integer, and an integer has no leading zero to keep. `067077086`
 * is saved back out as `67077086`, and the export notes describe exactly the
 * path that does it — BSNs "were collected for a period for insurance
 * experiments, then the field was hidden from the form; values were never
 * validated", so nothing between the form and this export would have noticed a
 * digit going missing off the front.
 *
 * Not ambiguous, and this is the reason: the missing digit is not guessed, it
 * is the only digit it could be. Nine digits lost one and eight remain; the
 * ones that remain are in order, because a spreadsheet drops the zero rather
 * than reshuffling what follows it; and the only digit a number can lose
 * silently at the front is a zero, since dropping any other digit changes the
 * value the spreadsheet was holding. One in, one place, one value.
 *
 * **Eight digits, and nothing besides.** The cell must be exactly eight ASCII
 * digits with nothing else in it — no space, no dot, no dash, no letter, no
 * padding at the ends:
 *
 * - **A grouped or padded cell is P26's first.** `"1234-5678"` and
 *   `"  12345678  "` are both eight digits under punctuation, and both are
 *   P26's fix — it proposes `"12345678"`, and this rule reads that on the next
 *   run and proposes the zero. Doing the cleaning and the padding in one
 *   proposal would be two fixes in one rule (1.1.4), and would put two rules'
 *   proposals on one cell in the same batch for a human to choose between.
 * - **A letter anywhere, or any other mark.** `"1234X678"`, `"onbekend"`,
 *   `"12345678,"`. This rule never strips and never reads around: a cell that
 *   is not eight digits is not eight digits, and P29 reports it whole.
 *
 * **Eight, and only eight.** Nine digits is the length a BSN is, and nothing to
 * do here. Seven digits is not padded to nine: two zeros off the front is not
 * what the catalogue describes and not something one lost digit explains — a
 * length that is neither eight nor nine is the wrong length after cleaning,
 * which is P29's finding and P29's sentence to the human. Empty and absent
 * cells hold no digits at all and are walked past for the same reason.
 *
 * **Whether the padded number is a real BSN is not asked here.** The
 * eleven-proef is P28's, and `"00000000"` is padded to `"000000000"` like any
 * other eight digits: this rule's question is how many digits the cell has, not
 * whether the number they spell is one a register would accept. Four rules read
 * this column and each does one thing to it (1.1.4) — P26 cleans, P27 restores
 * the length, P28 checks the sum, P29 asks a human about the rest.
 *
 * The column is read and the same column is proposed against (1.1.5), and what
 * is proposed is nine digits, so an approved row does not match the next time
 * the rules run.
 */

/** Exactly eight ASCII digits, and nothing else in the cell. */
const EXACTLY_EIGHT_DIGITS = /^[0-9]{8}$/;

export const p27: CatalogueRule = {
  ruleId: 'P27',
  version: 1,
  ruleName: 'Patient bsn is eight digits, missing its leading zero',
  description:
    "This patient's BSN holds eight digits where a BSN has nine — the shape a number takes " +
    'when a spreadsheet opened the export, read the cell as a number and dropped the zero ' +
    'off the front of it. The zero is proposed back: the same eight digits, in the same ' +
    'order, with a leading zero restored to make the nine-digit number that was typed. ' +
    'No other digit is added or changed, and whether the restored number passes the Dutch ' +
    'eleven-proef is left to the rule that asks that question.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every eight-digit BSN
   * (1.1.14). Tests `bsn` and changes `bsn` (1.1.5), and what it proposes is
   * nine digits, so an approved row stops matching the next time the rules run.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.bsn;

      // No value in the column at all. There are no digits here to count, and a
      // row with no BSN is not a row with a digit missing off the front.
      if (previous === null) {
        continue;
      }

      // Anything but exactly eight digits, and this rule has nothing to say.
      // Nine is the length a BSN is; a grouped or padded cell is P26's to clean
      // first; a letter, a stray mark or any other length is P29's, reported
      // whole rather than silently repaired here.
      if (!EXACTLY_EIGHT_DIGITS.test(previous)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `bsn`, so the id
        // is only the address of the row — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'bsn',
        // Reported exactly as stored, so a human comparing the two sees the
        // cell they would see in the row.
        prev: previous,
        // The zero the spreadsheet ate, put back in front of the digits it took
        // it from. Nothing else about the number changes.
        next: `0${previous}`,
      });
    }

    return { ambiguity: false, updates };
  },
};
