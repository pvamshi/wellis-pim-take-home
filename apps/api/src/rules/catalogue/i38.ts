import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I38 — an intake's `reviewer_note` with whitespace around it. Proposes the
 * trimmed text.
 *
 * Not ambiguous: padding is the spreadsheet's, not part of the note itself,
 * so trimming reads the cell rather than guessing at it. Unlike an id column,
 * a note that trims away to nothing is still a valid note — an empty comment
 * — so there is no companion rule to hand that case to.
 *
 * Tests `reviewer_note` and changes `reviewer_note` (1.1.5), and the trimmed
 * value has no padding left, so an approved row does not match again.
 */
export const i38: CatalogueRule = {
  ruleId: 'I38',
  version: 1,
  ruleName: 'Intake reviewer note has whitespace around it',
  description:
    "This intake's reviewer note has spaces around it. The trimmed text is proposed: " +
    'the same note, with the padding the old export left on it removed.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.reviewerNote;
      if (previous === null) continue;

      const next = previous.trim();

      // No padding to remove.
      if (next === previous) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'reviewer_note',
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
