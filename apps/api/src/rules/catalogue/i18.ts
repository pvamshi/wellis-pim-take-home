import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I18 — an intake's `weight` that parses cleanly as a number but is not a
 * plausible human weight in either unit: under 30 or over 400.
 *
 * Ambiguous: the number could be a typo, a misplaced decimal point, or a
 * real outlier, and nothing on the row says which (1.1.12).
 *
 * Boundary: only a cell clear of I15's comma, I16's unit and I17's
 * unparseable shapes reaches this check, so 30–400 needs no unit column —
 * implausible in kilograms and pounds alike. A number inside that range is
 * I19's: plausible, but with no unit column here to say which one.
 *
 * Tests `weight`; reports against `weight` (1.1.5), with no proposal since
 * no correction is certain.
 */

/** A clean, already-parseable weight: digits, with at most one dot. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

const MIN_PLAUSIBLE = 30;
const MAX_PLAUSIBLE = 400;

export const i18: CatalogueRule = {
  ruleId: 'I18',
  version: 1,
  ruleName: 'Intake weight is implausible in either unit',
  description:
    'This intake weight is under 30 or over 400, which is not a plausible human weight ' +
    'whether the column is read in kilograms or in pounds. The number itself is written ' +
    'cleanly, so the formatting is not in question — someone needs to say whether it is a ' +
    'typo, a misplaced decimal point, or a genuine outlier, because nothing on the row says ' +
    'which.',
  ambiguous: true,

  /**
   * Reads the whole intake table in one call and returns every clean weight
   * outside the plausible range (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.weight;
      if (previous === null) continue;

      const trimmed = previous.trim();
      if (!PLAIN_NUMBER.test(trimmed)) continue;

      const value = Number.parseFloat(trimmed);
      if (value >= MIN_PLAUSIBLE && value <= MAX_PLAUSIBLE) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'weight',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
