import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I30 — an intake's `alcohol_units_week` written with a comma where the
 * decimal point belongs: `5,5` where the rest of the column reads `5.5`.
 *
 * Not ambiguous: a comma sitting tight between digits, one or two after it,
 * has one reading, so nothing is guessed by writing it as a dot (1.1.12).
 *
 * Boundary: a second comma, or a comma with a dot already in the cell, is
 * not this rule's single reading and is left whole; a value written as a
 * range — I31's shape, comma decimal endpoints included — is left to it.
 *
 * Tests and changes `alcohol_units_week` (1.1.5); the proposal has a dot and
 * no comma, so an approved row does not match again.
 */

/**
 * A decimal comma: tight between digits, one or two after it, with no dot
 * and no second comma already in the cell — the one reading a comma has here.
 */
const COMMA_DECIMAL = /\d,\d{1,2}(?!\d)/;

/** I31's range separators, duplicated so this rule can walk past its finds. */
const RANGE_SEPARATOR = /-|à/i;

function hasCommaDecimal(value: string): boolean {
  if (value.includes('.')) return false;
  if (RANGE_SEPARATOR.test(value)) return false;
  if (value.indexOf(',') !== value.lastIndexOf(',')) return false;
  return COMMA_DECIMAL.test(value);
}

export const i30: CatalogueRule = {
  ruleId: 'I30',
  version: 1,
  ruleName: 'Intake weekly alcohol units is written with a comma decimal',
  description:
    'This intake weekly-alcohol-units value is written with a comma for the decimal point ' +
    '— 5,5 where the rest of the column is written 5.5. The same number is proposed with a ' +
    'dot in place of the comma: the digits are untouched, and only the separator changes.',
  ambiguous: false,

  /**
   * Reads the whole intake table in one call and returns every weekly-
   * alcohol-units cell whose decimal point is a comma (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.alcoholUnitsWeek;
      if (previous === null) continue;
      if (!hasCommaDecimal(previous)) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'alcohol_units_week',
        prev: previous,
        next: previous.replace(',', '.'),
      });
    }

    return { ambiguity: false, updates };
  },
};
