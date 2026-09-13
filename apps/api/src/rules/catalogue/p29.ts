import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P29 — a patient's `bsn` holding something that is not a citizen service
 * number: a letter anywhere in the cell, or a cell that is the wrong length
 * once the grouping is taken out — `"onbekend"`, `"1234X6789"`, `"1234567"`,
 * `"1234567890"`, `"123/456789"`, `"n.v.t."`, `"-"`.
 *
 * This is the last of the four rules on this column and the one that catches
 * what the other three cannot read. The export notes say BSNs "were collected
 * for a period for insurance experiments, then the field was hidden from the
 * form; values were never validated" — and a never-validated free-text box
 * collects whatever was in front of the person filling it in. A word meaning
 * "don't know". A dash meaning "none". A number copied out of a passport, an
 * insurance policy or a phone field. Nine digits with a letter typed in the
 * middle of them. None of those is a BSN, and none of them can be turned into
 * one by reading the cell harder.
 *
 * Ambiguous, and there is nothing that could make it otherwise:
 *
 * - **What is in the cell does not contain the number.** `"onbekend"` holds no
 *   digits. `"1234567"` holds seven, and nine digits with one missing gives no
 *   clue which one went or where it sat — a BSN is not derived from anything,
 *   it is issued. `"1234567890"` holds ten, and dropping one to make the count
 *   come out picks one of ten different numbers. Every repair here is an
 *   invented citizen service number, and an invented one that looks right is
 *   worse than a cell that visibly does not: it belongs to a real person, and
 *   it would be matched against an insurer's records as this patient.
 * - **Nothing else in the row holds it either.** A BSN appears in no other
 *   column and is encoded by no combination of them — a name, a date of birth
 *   and a city do not spell one. Reading another column to write this one would
 *   break 1.1.5 as well.
 * - **The right answer may be to empty the cell.** `"onbekend"`, `"n.v.t."` and
 *   `"-"` are somebody writing "there isn't one", and for those the resolution
 *   is taking the text out rather than finding a number. Which of the two a row
 *   needs is a decision about a person's record, and a human takes it.
 *
 * So this rule reports and proposes nothing (1.1.12), and its description is
 * the whole of what the human reads.
 *
 * **Both halves of the catalogue entry are one test.** "Contains letters" and
 * "is the wrong length after cleaning" are two ways into the same finding, and
 * the second covers the first: a letter left in the cell is not a digit, so a
 * cell with one in it is not the eight or nine digits this column's other rules
 * can read. The test is therefore stated once — take out the spaces, dots and
 * dashes P26 takes out, and what is left must be eight or nine ASCII digits —
 * and a letter, a slash, a comma, a bracket or a plus all fail it the same way.
 * Every cell that fails gets one finding under one id, however many ways it
 * fails (1.1.4).
 *
 * **"After cleaning" is P26's cleaning, and P26 goes first.** A cell whose
 * spaces, dots and dashes come out to leave digits is P26's fix this run:
 * `"123 4567"` becomes `"1234567"`, and this rule reads that on the next run
 * and reports the seven digits. Judging the length of a cell this rule had
 * stripped itself would put two rules' findings on one cell in one batch for a
 * human to choose between, which is what P27 and P28 both avoid by testing the
 * cell as it stands.
 *
 * **Eight and nine are both lengths this column has a rule for.** Nine is what
 * a BSN is, and whether those nine digits are a real one is P28's question.
 * Eight is a nine-digit number whose leading zero a spreadsheet ate, which P27
 * pads. Neither is the wrong length, so neither is reported here — reporting
 * one would put a second finding on a cell that already has its own rule and
 * its own fix.
 *
 * **A blank cell is not this rule's, and not anybody's.** `null`, `''` and a
 * cell of nothing but whitespace all look like the same nothing to whoever
 * opens the row, and they are folded together for that reason. They are walked
 * past because the catalogue gives `bsn` no empty rule, and that is the one
 * column where it gives none: `legacy_id`, `full_name`, `email`, `dob`, `sex`
 * and `phone` each have an id for the empty cell, and `bsn` has four rules and
 * not one of them is "empty". The notes say why — the field was collected for
 * an experiment and then hidden from the form, so a patient with no BSN is the
 * ordinary case rather than a defect, and there is nothing for a human to
 * decide about a cell nobody ever filled in. A finding on every such row would
 * be a rule this catalogue entry does not describe. A cell somebody typed a
 * mark into is a different thing and is reported: `"-"` and `"n.v.t."` are an
 * answer, not an absence, and the human either replaces them with the number or
 * clears them.
 *
 * The column is read and the same column is reported against (1.1.5), which is
 * what makes the rule self-terminating: a human writes the real number into the
 * cell the rule read — or empties it — and the row stops matching.
 */

/**
 * The grouping marks P26 removes — whitespace, the full stop and the hyphen —
 * taken out wherever they fall, so that this rule measures the same cleaned
 * value P26 would propose.
 *
 * A removal, never a filter: it takes out what it names and leaves everything
 * else in place, so a letter or a stray mark survives into the result and fails
 * the digits test below instead of disappearing out of the middle of a number
 * that then looks fine.
 */
const SEPARATORS = /[\s.-]/g;

/** Digits, at least one, and nothing else. */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * The two lengths this column has rules for: nine, which is what a BSN is and
 * P28's to check, and eight, which is a BSN missing the leading zero a
 * spreadsheet ate and P27's to pad.
 */
const EIGHT_OR_NINE_DIGITS = /^[0-9]{8,9}$/;

/** The cell with its spaces, dots and dashes taken out. */
function withoutSeparators(value: string): string {
  return value.replace(SEPARATORS, '');
}

/**
 * True when a cell that is present holds nothing but whitespace, which reads as
 * the same blank as an empty one to a human looking at the row.
 */
function isWhitespaceOnly(value: string): boolean {
  return value.trim().length === 0;
}

export const p29: CatalogueRule = {
  ruleId: 'P29',
  version: 1,
  ruleName: 'Patient bsn holds letters, or the wrong number of digits',
  description:
    "This patient's BSN cell does not hold a BSN. Once the spaces, dots and dashes a " +
    'typist groups digits with are taken out, what is left is not the nine digits a Dutch ' +
    'citizen service number has — there is a letter or another character among the digits, ' +
    'or there are too few or too many of them. The old form never checked this column, so ' +
    'whatever was typed stayed: a word like "onbekend", a dash meaning there is none, a ' +
    'number copied from a passport, an insurance policy or a phone, or nine digits with ' +
    'one mistyped, doubled or left out. Nothing is proposed, because the right number ' +
    'cannot be read out of what is there — adding or removing a digit to make the count ' +
    'come out would invent a citizen service number, and an invented one that looks ' +
    "correct belongs to a real person and would be matched against an insurer's records " +
    'as this patient. A human finds the real number — from the patient, the intake or the ' +
    'insurance paperwork — and writes it in, or empties the cell if there never was one.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every `bsn` that is
   * neither eight nor nine digits once the grouping comes out (1.1.14). Tests
   * `bsn` and reports against `bsn` (1.1.5), so a row whose human has written
   * the real number — or cleared the cell — stops matching the next time the
   * rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.bsn;

      // Nothing in the cell: absent, empty, or whitespace only — the three read
      // as the same blank to whoever opens the row. A patient with no BSN is
      // the ordinary case in this export, because the field was hidden from the
      // form, and the catalogue gives this column no empty rule, so there is no
      // finding to put in front of a human here.
      if (previous === null || isWhitespaceOnly(previous)) {
        continue;
      }

      const cleaned = withoutSeparators(previous);

      // Digits under the grouping, so P26 has a fix for this cell and goes
      // first: it proposes the digits alone, and this rule reads the result on
      // the next run. Measuring a value this rule had stripped itself would put
      // two findings on one cell in one batch (1.1.4).
      if (DIGITS_ONLY.test(cleaned) && cleaned !== previous) {
        continue;
      }

      // Nine digits is the length a BSN is, and whether they are a real one is
      // P28's question; eight digits is a leading zero a spreadsheet ate, which
      // P27 pads back. Both already have their own rule and their own fix.
      if (EIGHT_OR_NINE_DIGITS.test(cleaned)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `bsn`, so the id
        // is only the address of the row — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'bsn',
        // Reported exactly as stored, letters, marks, padding and all, so the
        // human sees the cell they would see in the row and can judge whether
        // it is a number to correct or a note to clear.
        prev: previous,
        // No value is proposed, and none can be (1.1.12).
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
