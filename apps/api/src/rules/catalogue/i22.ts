import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I22 — an intake's `height` written in feet and inches: `5'10"`, `5 ft 10`,
 * and the word-form and quote-mark spellings between them.
 *
 * Not ambiguous: the shape names its own two numbers, feet and inches, and
 * the centimetre figure is arithmetic on them — nothing here for a human to
 * decide (1.1.12).
 *
 * Boundary: the shape is unique to this rule — a comma decimal is I20's, a
 * bare number is I21's or I23's — so nothing else on `height` reads it.
 * Tests and changes `height` (1.1.5); the proposal is a bare number, which
 * this rule's own pattern requires a foot or inch mark to match, so an
 * approved row does not match again.
 */

/** `5'10"`, `5 ft 10`, `5ft10in`, and the marks between them. */
const FEET_AND_INCHES =
  /^(\d{1,2})\s*(?:'|ft\.?)\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|in\.?)?$/i;

const CM_PER_FOOT = 30.48;
const CM_PER_INCH = 2.54;

/** Rounds to one decimal place and drops a trailing `.0`. */
function formatCm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export const i22: CatalogueRule = {
  ruleId: 'I22',
  version: 1,
  ruleName: 'Intake height is expressed in feet and inches',
  description:
    'This intake height is written in feet and inches rather than centimetres. The ' +
    'centimetre value is proposed: the feet and inches read off the cell, each converted at ' +
    'its own fixed rate and added together, the way a height in feet and inches always ' +
    'converts to centimetres.',
  ambiguous: false,

  /**
   * Reads the whole intake table in one call and returns every height written
   * in feet and inches, converted to centimetres (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.height;
      if (previous === null) continue;

      const matched = FEET_AND_INCHES.exec(previous.trim());
      if (matched === null) continue;

      const feet = Number.parseFloat(matched[1] ?? '0');
      const inches = Number.parseFloat(matched[2] ?? '0');

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'height',
        prev: previous,
        next: formatCm(feet * CM_PER_FOOT + inches * CM_PER_INCH),
      });
    }

    return { ambiguity: false, updates };
  },
};
