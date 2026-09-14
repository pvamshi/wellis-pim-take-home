import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I33 — an intake's `alcohol_units_week` that parses cleanly as a single
 * signed number, dot or comma decimal, but is negative or over 100 units a
 * week — not a plausible count either way.
 *
 * Ambiguous: the figure could be a typo, a misplaced sign or decimal point,
 * or a genuine outlier, and nothing on the row says which (1.1.12).
 *
 * Boundary: a range is I31's shape and a word is I32's; only a single number
 * — comma decimal included, so this runs ahead of I30's reformatting rather
 * than after it — reaches this plausibility check.
 *
 * Tests `alcohol_units_week`; reports against `alcohol_units_week` (1.1.5),
 * with no proposal since no correction is certain.
 */

/** A single signed number, dot or comma decimal. */
const PLAIN_NUMBER = /^-?\d+(?:[.,]\d+)?$/;

const MAX_PLAUSIBLE = 100;

export const i33: CatalogueRule = {
  ruleId: 'I33',
  version: 1,
  ruleName: 'Intake weekly alcohol units is negative or implausibly high',
  description:
    'This intake weekly-alcohol-units value is negative, or over 100 units a week, which ' +
    'is not a plausible count. The number itself is written cleanly, so the formatting is ' +
    'not in question — someone needs to say whether it is a typo, a misplaced sign or ' +
    'decimal point, or a genuine outlier, because nothing on the row says which.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.alcoholUnitsWeek;
      if (previous === null) continue;

      const trimmed = previous.trim();
      if (!PLAIN_NUMBER.test(trimmed)) continue; // I31's or I32's finding.

      const value = Number.parseFloat(trimmed.replace(',', '.'));
      if (value >= 0 && value <= MAX_PLAUSIBLE) continue;

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
