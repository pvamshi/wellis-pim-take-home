import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I23 — an intake's `height` that either is not a number at all, or parses
 * cleanly but is not a plausible human height: under 100 or over 250.
 *
 * Ambiguous: either way there is no single reading to propose — an
 * unparseable cell names no number, and an implausible one could be a typo,
 * a unit mistake, or a real outlier — and nothing says which (1.1.12).
 *
 * Boundary: a cell already read by I20's comma, I21's metres or I22's feet
 * and inches is that rule's finding; what is left is either unparseable or a
 * clean number of 3 or more still outside 100–250.
 *
 * Tests `height`; reports against `height` (1.1.5), with no proposal since
 * no reading is certain.
 */

/** A clean, already-parseable height: digits, with at most one dot. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

/** I20's decimal comma, duplicated so this rule can walk past its finds. */
const COMMA_DECIMAL = /\d,\d{1,2}(?!\d)/;

/** I22's feet-and-inches shape, duplicated so this rule can walk past its finds. */
const FEET_AND_INCHES =
  /^(\d{1,2})\s*(?:'|ft\.?)\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|in\.?)?$/i;

/** True when I20 or I22 already has a clean, unambiguous fix for this cell. */
function readByANeighbour(trimmed: string): boolean {
  const isCommaDecimal =
    !trimmed.includes('.') &&
    trimmed.indexOf(',') === trimmed.lastIndexOf(',') &&
    COMMA_DECIMAL.test(trimmed);
  if (isCommaDecimal) return true;

  return FEET_AND_INCHES.test(trimmed);
}

const METRES_CEILING = 3;
const MIN_PLAUSIBLE = 100;
const MAX_PLAUSIBLE = 250;

export const i23: CatalogueRule = {
  ruleId: 'I23',
  version: 1,
  ruleName: 'Intake height is not a number, or is implausible',
  description:
    'This intake height either does not read as a number at all, or reads as one that is ' +
    'under 100 or over 250 — not a plausible human height in centimetres. A height is only ' +
    'ever read as a number, and there is no single reading to propose here, so someone has ' +
    'to say what this cell was meant to hold.',
  ambiguous: true,

  /**
   * Reads the whole intake table in one call and returns every height that is
   * unparseable or implausible once parsed (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.height;
      if (previous === null) continue;

      const trimmed = previous.trim();
      if (trimmed.length === 0) continue;

      if (!PLAIN_NUMBER.test(trimmed)) {
        if (readByANeighbour(trimmed)) continue; // I20's or I22's finding.

        updates.push({
          table: 'intake' as const,
          legacyId: intake.legacyIntakeId,
          column: 'height',
          prev: previous,
          next: null,
        });
        continue;
      }

      const value = Number.parseFloat(trimmed);
      if (value < METRES_CEILING) continue; // I21's finding.
      if (value >= MIN_PLAUSIBLE && value <= MAX_PLAUSIBLE) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'height',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
