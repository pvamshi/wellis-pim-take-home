import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I39 — an intake's `alcohol_units_week` written as a count of alcohol units
 * rather than in millilitres: a clean number such as `14` or `2.5`, with no
 * `ml` after it.
 *
 * Created alongside I34 v2 (1.5.2). I34 v1 was sent back with "replace all
 * values to ml"; I34 is about an empty cell, which has no value to convert, so
 * the conversion is a rule of its own (1.1.4).
 *
 * Not ambiguous: one alcohol unit is 10 ml of pure alcohol by definition, so a
 * count of units has exactly one reading in millilitres. The proposal is the
 * count times ten, written `<n> ml` — `14` becomes `140 ml`, `2.5` becomes
 * `25 ml`. The `ml` is what marks the cell as converted, so an approved row
 * does not match again and is not multiplied a second time (1.1.5).
 *
 * Boundary: only a clean, dot-decimal number from 0 to 100 is converted. A
 * comma decimal is I30's to reformat first, and matches here on the next run;
 * a range is I31's, words are I32's, a negative or over-100 figure is I33's
 * to settle before any conversion, and an empty cell is I34's. A cell that
 * already ends in `ml` is left alone.
 *
 * Tests and changes `alcohol_units_week` (1.1.5).
 */

/** A clean non-negative number, dot decimal, whitespace around it allowed. */
const PLAIN_NUMBER = /^\d+(?:\.\d+)?$/;

/** I33's ceiling: over this many units a week is its finding, not this one's. */
const MAX_PLAUSIBLE = 100;

/** Millilitres of pure alcohol in one unit. */
const ML_PER_UNIT = 10;

/** The unit count as millilitres, without floating-point noise: `0.3` → `3`. */
function toMillilitres(units: number): string {
  return String(Number((units * ML_PER_UNIT).toFixed(6)));
}

export const i39: CatalogueRule = {
  ruleId: 'I39',
  version: 1,
  ruleName: 'Intake weekly alcohol is not in millilitres',
  description:
    'This intake weekly-alcohol value is a count of alcohol units rather than an amount ' +
    'in millilitres. The column is kept in millilitres of pure alcohol a week, and one ' +
    'unit is 10 ml, so the rule multiplies the count by ten and writes it with "ml" after ' +
    'it — 14 becomes "140 ml". Only a clean number from 0 to 100 is converted; a comma ' +
    'decimal, a range, words, or an implausible figure is settled by its own rule first.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.alcoholUnitsWeek;
      if (previous === null) continue; // I34's finding.

      const trimmed = previous.trim();
      if (!PLAIN_NUMBER.test(trimmed)) continue; // Another rule's, or already in ml.

      const units = Number.parseFloat(trimmed);
      if (units > MAX_PLAUSIBLE) continue; // I33's finding.

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'alcohol_units_week',
        prev: previous,
        next: `${toMillilitres(units)} ml`,
      });
    }

    return { ambiguity: false, updates };
  },
};
