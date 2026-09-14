import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I15 — an intake's `weight` written with a comma where the decimal point
 * belongs: `82,5` where the rest of the column reads `82.5`.
 *
 * Not ambiguous: a comma sitting tight between digits, one or two after it,
 * has one reading, so nothing is guessed by writing it as a dot (1.1.12).
 *
 * Boundary: a second comma, or a comma with a dot already in the cell, is not
 * this rule's single reading and is left whole; an empty cell has no comma
 * to move.
 *
 * Tests and changes `weight` (1.1.5); the proposal has a dot and no comma,
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

export const i15: CatalogueRule = {
  ruleId: 'I15',
  version: 1,
  ruleName: 'Intake weight is written with a comma decimal',
  description:
    'This intake weight is written with a comma for the decimal point — 82,5 where the ' +
    'rest of the column is written 82.5. A weight is only ever read as a number, and this ' +
    'one reads as no number at all, or as the whole kilograms with the fraction silently ' +
    'dropped off the end. The same number is proposed with a dot in place of the comma: the ' +
    'digits are untouched, and only the separator changes. Whether the cell carries a unit ' +
    'written into it, is a plausible weight, or has no unit column to check it against are ' +
    'other questions and other rules.',
  ambiguous: false,

  /**
   * Reads the whole intake table in one call and returns every weight whose
   * decimal point is a comma (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.weight;
      if (previous === null) continue;
      if (!hasCommaDecimal(previous)) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'weight',
        prev: previous,
        next: previous.replace(',', '.'),
      });
    }

    return { ambiguity: false, updates };
  },
};
