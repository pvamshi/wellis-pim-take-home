import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I27 — an intake's `conditions` with whitespace around it: real text, the
 * old export padded. Proposes the trimmed text.
 *
 * Not ambiguous: padding is the spreadsheet's, not part of what was written,
 * so trimming reads the cell rather than guessing at it (1.1.12).
 *
 * Boundary: a cell that trims down to nothing has no text left to propose,
 * and a cell whose trimmed content is one of I28's empty-markers is I28's
 * finding — that rule folds padding and canonicalisation into one fix.
 *
 * Tests and changes `conditions` (1.1.5); the trimmed value has no padding
 * left, so an approved row does not match on the next run.
 */

/** I28's closed set of "nothing" markers, duplicated so this rule can walk past its finds. */
const EMPTY_MARKERS: ReadonlySet<string> = new Set(['none', 'geen', 'n/a', '-', 'nvt', 'x']);

export const i27: CatalogueRule = {
  ruleId: 'I27',
  version: 1,
  ruleName: 'Intake conditions has whitespace around it',
  description:
    "This intake's conditions text has spaces around it. The trimmed text is proposed: " +
    'the same words, with the padding the old export left on it removed.',
  ambiguous: false,

  /**
   * Reads the whole intake table in one call and returns every conditions
   * cell with padding around real text (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.conditions;
      if (previous === null) continue;

      const trimmed = previous.trim();
      if (trimmed.length === 0) continue; // Nothing left to propose.
      if (EMPTY_MARKERS.has(trimmed.toLowerCase())) continue; // I28's finding.
      if (trimmed === previous) continue; // No padding to remove.

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'conditions',
        prev: previous,
        next: trimmed,
      });
    }

    return { ambiguity: false, updates };
  },
};
