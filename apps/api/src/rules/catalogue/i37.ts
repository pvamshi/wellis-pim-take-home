import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I37 — an intake row with no `outcome` at all: the cell absent, empty, or
 * holding nothing but whitespace.
 *
 * Ambiguous: nothing else in the row states a result — `reviewer_note` is
 * free text and neither confirms nor rules out approved, rejected or
 * pending — and there is no safe default among three answers where guessing
 * writes a result nobody confirmed (1.1.12).
 *
 * Tests `outcome` and reports against `outcome` (1.1.5); a cell I35 or I36
 * would read is walked past, so a row a human writes an answer into does not
 * match again.
 */

/** True when the cell holds no value: absent, empty, or nothing but whitespace. */
function isMissing(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const i37: CatalogueRule = {
  ruleId: 'I37',
  version: 1,
  ruleName: 'Intake outcome is empty',
  description:
    'This intake row has no outcome — the column is empty, or holds nothing but ' +
    'whitespace. Nothing else on the row says whether the intake was approved, rejected or ' +
    'is still pending, and there is no safe default among the three to assume. A human ' +
    'finds out which result applies and writes it in, or decides the blank is correct and ' +
    'leaves it.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.outcome;
      if (!isMissing(previous)) continue; // I35's or I36's finding.

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'outcome',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
