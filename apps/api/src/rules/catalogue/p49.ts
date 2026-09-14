import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P49 — a patient's `height_cm` written with a comma where the decimal point
 * belongs: `175,5` where the rest of the column reads `175.5`.
 *
 * Not ambiguous: the same reasoning as P41's comma decimal on `weight` — a
 * comma sitting tight between digits, one or two after it, has one reading
 * (1.1.12). The magnitude is not this rule's concern: a fixed value that still
 * reads as metres, or is still implausible, is P50's or P53's finding on the
 * next run, not this one's.
 *
 * Boundary: a grouped or otherwise unclear comma is P52's finding; the
 * feet-and-inches shape has no comma to fix and is P51's entirely. Tests and
 * changes `height_cm` (1.1.5); the proposal has a dot and no comma, so an
 * approved row does not match again.
 */

/**
 * A decimal comma: a comma sitting tight between digits, one or two after it,
 * with no dot and no second comma already in the cell — see P41 for why each
 * guard is there.
 */
const COMMA_DECIMAL = /\d,\d{1,2}(?!\d)/;

function hasCommaDecimal(value: string): boolean {
  if (value.includes('.')) return false;
  if (value.indexOf(',') !== value.lastIndexOf(',')) return false;
  return COMMA_DECIMAL.test(value);
}

export const p49: CatalogueRule = {
  ruleId: 'P49',
  version: 1,
  ruleName: 'Patient height is written with a comma decimal',
  description:
    'The height is written with a comma for the decimal point — 175,5 where the rest of ' +
    'the column is written 175.5. A height is only ever read as a number, and this one reads ' +
    'as no number at all, or as the whole centimetres with the fraction silently dropped off ' +
    'the end. The same number is proposed with a dot in place of the comma: the digits are ' +
    'untouched, and only the character between them changes. Whether the resulting number is ' +
    'a plausible height, or is written in metres rather than centimetres, is a different ' +
    'question and a different rule.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.heightCm;
      if (previous === null) continue;
      if (!hasCommaDecimal(previous)) continue;

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'height_cm',
        prev: previous,
        next: previous.replace(',', '.'),
      });
    }

    return { ambiguity: false, updates };
  },
};
