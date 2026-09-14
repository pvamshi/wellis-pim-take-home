import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I32 — an intake's `alcohol_units_week` written in words rather than a
 * number: `occasionally`, `soms`, `socially`, and anything else non-empty
 * that is not a range and does not parse as a single signed number.
 *
 * Ambiguous: a frequency word names no unit count, and there is no safe
 * number to read it as (1.1.12).
 *
 * Boundary: a range is I31's shape and a bare number, comma decimal
 * included, is I30's or I33's territory; an empty cell is I34's.
 *
 * Tests and reports against `alcohol_units_week` (1.1.5); a human writing a
 * real number in is what keeps an approved row from matching again.
 */

/** I31's range shape, duplicated so this rule can walk past its finds. */
const RANGE = /^(\d+(?:[.,]\d+)?)\s*(?:-|à)\s*(\d+(?:[.,]\d+)?)$/i;

/** A single signed number, dot or comma decimal — I30's and I33's territory. */
const PLAIN_NUMBER = /^-?\d+(?:[.,]\d+)?$/;

export const i32: CatalogueRule = {
  ruleId: 'I32',
  version: 1,
  ruleName: 'Intake weekly alcohol units is written in words',
  description:
    'This intake weekly-alcohol-units value is written in words rather than as a number ' +
    '— such as occasionally, soms or socially. A frequency word names no unit count, so no ' +
    'number is proposed. A human who can ask the patient has to write the real figure in.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.alcoholUnitsWeek;
      if (previous === null) continue; // I34's finding.

      const trimmed = previous.trim();
      if (trimmed.length === 0) continue; // I34's finding.
      if (RANGE.test(trimmed)) continue; // I31's finding.
      if (PLAIN_NUMBER.test(trimmed)) continue; // I30's or I33's territory.

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
