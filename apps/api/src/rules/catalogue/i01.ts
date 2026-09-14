import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I01 — an intake's `intake_id` with whitespace around it. Proposes the
 * trimmed id.
 *
 * Not ambiguous: padding is the spreadsheet's, not part of the id, so
 * trimming reads the cell rather than guessing at it. An id that trims away
 * to nothing is left alone — this rule proposes an id, and an empty string
 * is not one.
 *
 * Tests `intake_id` and changes `intake_id` (1.1.5), and the trimmed value
 * has no padding left, so an approved row does not match on the next run.
 */

export const i01: CatalogueRule = {
  ruleId: 'I01',
  version: 1,
  ruleName: 'Intake id has whitespace around it',
  description:
    "This intake's id has spaces around it. The trimmed id is proposed: the same id, " +
    'with the padding the old export left on it removed, so it matches the id every ' +
    'other table refers to it by.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.legacyIntakeId;
      if (previous === null) continue;

      const next = previous.trim();

      // Nothing left to address the row by — left alone, not invented here.
      if (next.length === 0) continue;

      // No padding to remove.
      if (next === previous) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'intake_id',
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
