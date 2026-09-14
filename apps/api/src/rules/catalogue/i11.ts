import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I11 — an intake row whose `submitted_at` is empty: missing outright, or
 * holding nothing but whitespace.
 *
 * Ambiguous: a submission date is a fact about what happened, not something
 * this rule can derive from the rest of the row — nothing else on it says
 * when the form was actually filled in (1.1.12).
 *
 * Boundary: any cell with real content, however malformed, is I06 through
 * I10's business and not this rule's — those rules see a value to judge,
 * this one sees none.
 *
 * Tests `submitted_at` and reports against it (1.1.5); a human writing the
 * real submission date in is what keeps an approved row from matching again.
 */

function isEmpty(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const i11: CatalogueRule = {
  ruleId: 'I11',
  version: 1,
  ruleName: 'Intake submitted date is empty',
  description:
    "This intake row has no submitted date — the column is empty, missing, or holds " +
    'nothing but whitespace. Nothing else on the row says when the form was actually ' +
    'filled in, so no date is proposed here. Someone who can check the real submission ' +
    'date has to write it in, year-month-day.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.submittedAt;
      if (!isEmpty(previous)) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'submitted_at',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
