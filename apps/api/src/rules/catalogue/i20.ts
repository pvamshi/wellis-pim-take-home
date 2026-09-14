import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I20 — an intake's `height` written with a comma where the decimal point
 * belongs: `175,5` where the rest of the column reads `175.5`.
 *
 * Not ambiguous: a comma sitting tight between digits, one or two after it,
 * has one reading, so nothing is guessed by writing it as a dot (1.1.12).
 *
 * Boundary: a second comma, or a comma with a dot already in the cell, is not
 * this rule's single reading and is left whole; whether the resulting number
 * is in metres or is implausible is I21's or I23's question, not this one's.
 *
 * Tests and changes `height` (1.1.5); the proposal has a dot and no comma,
 * so an approved row does not match again.
 */

/**
 * A decimal comma: tight between digits, one or two after it, with no dot
 * and no second comma already in the cell — the one reading a comma has here.
 */
const COMMA_DECIMAL = /\d,\d{1,2}(?!\d)/;

function hasCommaDecimal(value: string): boolean {
  if (value.includes('.')) return false;
  if (value.indexOf(',') !== value.lastIndexOf(',')) return false;
  return COMMA_DECIMAL.test(value);
}

export const i20: CatalogueRule = {
  ruleId: 'I20',
  version: 1,
  ruleName: 'Intake height is written with a comma decimal',
  description:
    'This intake height is written with a comma for the decimal point — 175,5 where the ' +
    'rest of the column is written 175.5. A height is only ever read as a number, and this ' +
    'one reads as no number at all, or as the whole centimetres with the fraction silently ' +
    'dropped off the end. The same number is proposed with a dot in place of the comma: the ' +
    'digits are untouched, and only the separator changes. Whether the resulting number is ' +
    'written in metres, or is a plausible height, is a different question and a different rule.',
  ambiguous: false,

  /**
   * Reads the whole intake table in one call and returns every height whose
   * decimal point is a comma (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.height;
      if (previous === null) continue;
      if (!hasCommaDecimal(previous)) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'height',
        prev: previous,
        next: previous.replace(',', '.'),
      });
    }

    return { ambiguity: false, updates };
  },
};
