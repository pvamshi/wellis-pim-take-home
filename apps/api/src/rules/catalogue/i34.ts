import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I34 — an intake row with no `alcohol_units_week` at all: the cell absent,
 * empty, or holding nothing but whitespace.
 *
 * Ambiguous: nothing else on the row states a weekly count, and there is no
 * safe number to assume in its place (1.1.12).
 *
 * Boundary: any cell with real content, however malformed, is I30's, I31's,
 * I32's or I33's finding — this rule sees no value at all to judge.
 *
 * Tests `alcohol_units_week` and reports against it (1.1.5); a human writing
 * a real figure in, or confirming the blank is correct, is what keeps an
 * approved row from matching again.
 */

/** True when the cell holds no value: absent, empty, or nothing but whitespace. */
function isMissing(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const i34: CatalogueRule = {
  ruleId: 'I34',
  version: 1,
  ruleName: 'Intake weekly alcohol units is empty',
  description:
    'This intake row has no weekly-alcohol-units value — the column is empty, or holds ' +
    'nothing but whitespace. Nothing else on the row says how many units a week the ' +
    'patient reported, and there is no safe number to assume, so nothing is proposed. A ' +
    'human finds out the real figure and writes it in, or decides the blank is correct and ' +
    'leaves it.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.alcoholUnitsWeek;
      if (!isMissing(previous)) continue; // I30's, I31's, I32's or I33's finding.

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
