import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I31 — an intake's `alcohol_units_week` written as a range rather than one
 * number: `5-10`, `5 à 10`.
 *
 * Ambiguous: a range names two numbers, not one, and which end — the low,
 * the high, or something between — was meant is a human call, not one this
 * rule can settle by picking a side (1.1.12).
 *
 * Boundary: the range shape requires two number groups either side of a
 * separator, so a single comma-decimal value with no separator is I30's
 * finding and never reaches this rule's pattern.
 *
 * Tests `alcohol_units_week`; reports against `alcohol_units_week` (1.1.5),
 * with no proposal since no single number is certain.
 */

/** Two numbers either side of a hyphen or `à`, and nothing else in the cell. */
const RANGE = /^(\d+(?:[.,]\d+)?)\s*(?:-|à)\s*(\d+(?:[.,]\d+)?)$/i;

export const i31: CatalogueRule = {
  ruleId: 'I31',
  version: 1,
  ruleName: 'Intake weekly alcohol units is written as a range',
  description:
    'This intake weekly-alcohol-units value is written as a range — such as 5-10 or 5 à ' +
    '10 — rather than one number. A range names two numbers, and nothing on the row says ' +
    'whether the low end, the high end, or something between was meant, so nothing is ' +
    'proposed: someone who can ask the patient needs to say which figure to record.',
  ambiguous: true,

  /**
   * Reads the whole intake table in one call and returns every weekly-
   * alcohol-units cell written as a range (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.alcoholUnitsWeek;
      if (previous === null) continue;
      if (!RANGE.test(previous.trim())) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'alcohol_units_week',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
