import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I21 — an intake's `height` that parses cleanly as a number but reads under
 * 3: nobody is 3cm tall, and every adult is well under 3m, so a value this
 * small was recorded in metres and is converted.
 *
 * Not ambiguous: under 3 has exactly one sane reading in a height column
 * (1.1.12). The conversion is arithmetic, not a guess — the same ×100 a
 * height in metres always takes to become centimetres.
 *
 * Boundary: only a cell already clear of I20's comma reaches this check, so
 * the number read here is already dot-decimal or a bare integer; a value at
 * 3 or above that is still implausible is I23's, and the feet-and-inches
 * shape is I22's, not this rule's to parse.
 */

/** A clean, already-parseable height: digits, with at most one dot. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

const METRES_CEILING = 3;

/** Rounds to one decimal place and drops a trailing `.0`. */
function formatCm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export const i21: CatalogueRule = {
  ruleId: 'I21',
  version: 1,
  ruleName: 'Intake height is expressed in metres',
  description:
    'This intake height reads under 3, which is not a plausible height in centimetres — it ' +
    'is a height recorded in metres instead. The centimetre value is proposed: the same ' +
    'figure, multiplied by 100, the way a height in metres always converts to centimetres.',
  ambiguous: false,

  /**
   * Reads the whole intake table in one call and returns every height read in
   * metres, converted to centimetres (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.height;
      if (previous === null) continue;

      const trimmed = previous.trim();
      if (!PLAIN_NUMBER.test(trimmed)) continue; // I20's or I22's finding.

      const value = Number.parseFloat(trimmed);
      if (value >= METRES_CEILING) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'height',
        prev: previous,
        next: formatCm(value * 100),
      });
    }

    return { ambiguity: false, updates };
  },
};
