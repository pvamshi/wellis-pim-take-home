import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I34 v2 — same catch as v1: an intake row with no `alcohol_units_week` at
 * all, the cell absent, empty, or holding nothing but whitespace. Still
 * ambiguous, still proposing nothing.
 *
 * What changed is what the human is asked for. v1 was sent back with "replace
 * all values to ml": the column's figures are now millilitres of pure alcohol
 * a week, and turning a unit count into millilitres is I39's fix, not this
 * rule's (1.1.4, 1.5.2). An empty cell has no number to convert, so this rule
 * keeps flagging it — and the figure a human writes in is now asked for in
 * millilitres, in the same `<n> ml` form I39 proposes.
 *
 * Why still ambiguous: nothing else on the row states a weekly amount, and
 * there is no safe number to assume in its place (1.1.12).
 *
 * Boundary unchanged from v1: any cell with real content, however malformed,
 * is I30's, I31's, I32's, I33's or I39's finding.
 *
 * Re-implemented standalone rather than importing v1 (1.1.8): a version is
 * frozen code.
 */

/** True when the cell holds no value: absent, empty, or nothing but whitespace. */
function isMissing(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const i34V2: CatalogueRule = {
  ruleId: 'I34',
  version: 2,
  ruleName: 'Intake weekly alcohol units is empty',
  description:
    'This intake row has no weekly-alcohol value — the column is empty, or holds nothing ' +
    'but whitespace. Nothing else on the row says how much the patient reported drinking, ' +
    'and there is no safe number to assume, so nothing is proposed. The column is now ' +
    'kept in millilitres of pure alcohol a week, so a human finds out the real figure and ' +
    'writes it in millilitres, as "<n> ml" (one unit is 10 ml), or decides the blank is ' +
    'correct and leaves it.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.alcoholUnitsWeek;
      if (!isMissing(previous)) continue; // Another rule's finding, or nothing wrong.

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
