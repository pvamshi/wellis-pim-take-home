import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P41 — a patient's `weight` written with a comma where the decimal point
 * belongs: `82,5` in a column whose every other row reads `82.5`.
 *
 * The export notes call weight self-reported at submission time, which is the
 * whole of the problem: the number was typed by the patient, on a Dutch form,
 * on a keyboard where the decimal separator is a comma. `82,5 kilo` is how the
 * weight is said and how it is written, and the column is `text` like every
 * other column of the export, so nothing on the way in argued with it. The
 * comma is sitting there exactly as typed.
 *
 * What it costs is the whole value. A weight is only ever read as a number —
 * compared against a threshold, averaged, charted, converted — and `82,5` is
 * not a number to anything that reads this column. It parses as nothing at all
 * in the strict readers, and in the forgiving ones it parses as `82` with the
 * fraction silently dropped off the end. Both readings are wrong, and the
 * second is worse than the first, because a row that quietly loses its half
 * kilogram looks exactly like a row that never had one.
 *
 * Not ambiguous. A comma sitting tight between digits with one or two digits
 * after it is a decimal point and there is no second reading of it — nobody
 * writes a thousands separator two digits from the end of a number, and nobody
 * weighs eight hundred and twenty-five thousand of anything. The digits
 * themselves are not touched: the proposal is the number the patient reported,
 * with the character between its two halves written the way the rest of the
 * column writes it. Nothing is chosen on the row's behalf, so there is nothing
 * for a human to decide (1.1.12).
 *
 * Where the rule stops, and why each line is drawn there:
 *
 * - **More than one comma.** `1,234,5` is either a grouped number or not a
 *   number at all, and telling which is a reading rather than a rewrite. P43
 *   is the rule for a cell that is not a number.
 * - **A dot already in the cell.** `1,234.5` has its decimal point already, and
 *   the comma in front of it is a thousands separator; swapping it would
 *   produce `1.234.5`, which is not a number in any convention. There is no fix
 *   here for this rule to make.
 * - **Three or more digits after the comma.** `1,234` and `82,500` are the
 *   shape of a thousands group exactly as much as they are the shape of a
 *   fraction, and a rule that proposes a value proposes it only where there is
 *   one reading. These cells go to P43 and P44 — not a number, or a number
 *   nobody weighs — with a human reading them rather than this rule guessing.
 * - **A comma with no digit against it.** `,5`, `82, 5` and `onbekend, zie
 *   dossier` all hold a comma and none of them holds a decimal comma, which is
 *   written tight between the digits it separates.
 * - **An empty cell.** P45's finding. There is no number here to repunctuate.
 *
 * What it hands on, with the separator settled:
 *
 * - **A cell carrying its unit.** `82,5 kg` comes back as `82.5 kg`. The unit
 *   written into the value is P42's finding and P42's approval (1.1.4); this
 *   rule only settles which character stands between the kilograms and the
 *   fraction, and it leaves every other character of the cell — the unit, and
 *   any padding around it — exactly as it stands. It is the line P37 walks when
 *   it cleans the casing of an address sitting in the city column.
 * - **A weight nobody has.** `1,5` comes back as `1.5`, and 1.5 is still under
 *   P44's floor. Fixing how a number is written says nothing about whether the
 *   number is right, and this rule claims nothing about that.
 *
 * The rule never reads `weight_unit`, and could not use it if it did: which
 * unit the number is in changes nothing about which character separates its
 * digits, and reading one column to write another is the thing 1.1.5 forbids —
 * the same constraint that leaves pounds-to-kilograms conversion out of this
 * catalogue entirely. This rule reads `weight` and reports against `weight`,
 * which is also what makes it self-terminating: the approved value has a dot in
 * it and no comma, so the rule walks past it on the next run.
 *
 * `height_cm` has the identical defect and a rule of its own, P49. One rule per
 * column, because the sentence a human reads names the column it is about
 * (1.1.4).
 *
 * In the export in hand every weight already arrived with a dot, so this rule
 * finds nothing today. That is not a reason to leave it unwritten: the next
 * export of a self-reported number typed on a Dutch form will not be, and a
 * rule that matches no row costs nothing — the rules screen only shows rules
 * with something to say.
 */

/**
 * A decimal comma: a comma sitting tight between digits, with one or two digits
 * after it and no third digit behind them.
 *
 * The digit in front is what separates `82,5` from `,5`. The one-or-two limit
 * is what separates it from `1,234`, where the same characters read as a
 * thousands group and the rule has no single reading to propose.
 */
const COMMA_DECIMAL = /\d,\d{1,2}(?!\d)/;

/**
 * True when the cell holds a number whose decimal point was typed as a comma,
 * and nothing else is going on in it.
 *
 * Two guards before the shape is even looked for. A dot anywhere means the
 * decimal point is already written and the comma is doing some other job; a
 * second comma means the value is grouped, or is not a number. Both are cells
 * this rule reports nothing about, so that whatever is wrong with them reaches
 * the rules written for it.
 */
function hasCommaDecimal(value: string): boolean {
  if (value.includes('.')) {
    return false;
  }

  if (value.indexOf(',') !== value.lastIndexOf(',')) {
    return false;
  }

  return COMMA_DECIMAL.test(value);
}

export const p41: CatalogueRule = {
  ruleId: 'P41',
  version: 1,
  ruleName: 'Patient weight is written with a comma decimal',
  description:
    'The weight is written with a comma for the decimal point — 82,5 where the rest of the ' +
    'column is written 82.5. The number was self-reported on a Dutch form, where the ' +
    'decimal separator is a comma, and the export stores every column as text, so the comma ' +
    'was kept exactly as it was typed. A weight is only ever read as a number, and this one ' +
    'reads as no number at all, or as the whole kilograms with the fraction silently dropped ' +
    'off the end — which files the patient at a weight they never reported and looks, from ' +
    'the outside, like a patient who never reported a fraction. The same number is proposed ' +
    'with a dot in place of the comma: the digits are untouched, and only the character ' +
    'between them changes. Nothing else about the cell is changed — a unit typed into the ' +
    'value stays where it is, and whether the number is plausible, and whether it is in ' +
    'kilograms or in pounds, are other questions and other rules.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every weight whose
   * decimal point is a comma (1.1.14). Tests `weight` and changes `weight`
   * (1.1.5), so an approved row stops matching the next time the rules run:
   * the proposal has a dot where the comma was, and a dot in the cell is the
   * first thing this rule walks past.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.weight;

      // The column holds nothing at all. An absent weight is P45's finding,
      // and there is no number here to repunctuate (1.1.4).
      if (previous === null) {
        continue;
      }

      if (!hasCommaDecimal(previous)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `weight`, so the
        // id is only the address of the row — whatever is wrong with the id
        // itself belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'weight',
        prev: previous,
        // Only the one comma moves. Every other character of the cell — a unit
        // typed into the value, and any padding around it — is handed back
        // exactly as it stands, so P42's finding survives this rule's fix.
        next: previous.replace(',', '.'),
      });
    }

    return { ambiguity: false, updates };
  },
};
