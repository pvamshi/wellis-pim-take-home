import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I02 — an intake row whose `intake_id` is empty: missing outright, or
 * holding nothing but whitespace.
 *
 * Ambiguous: an intake id is issued by the form tool, not derived from the
 * rest of the row — nothing else on it says what the id was (1.1.12).
 *
 * Boundary: an id with real content, however padded, is I01's business —
 * trimming it away to nothing is what hands the row here instead.
 *
 * Tests `intake_id` and reports against it (1.1.5); a human supplying the
 * real id is what keeps an approved row from matching again.
 */

function isEmpty(value: string): boolean {
  return value.trim().length === 0;
}

export const i02: CatalogueRule = {
  ruleId: 'I02',
  version: 1,
  ruleName: 'Intake id is empty',
  description:
    'This intake row has no id — the column is empty, or holds nothing but whitespace. ' +
    'An intake id is issued by the form tool, not derived from the rest of the row, so ' +
    'someone who knows which submission this was has to write the real id in.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.legacyIntakeId;
      if (!isEmpty(previous)) continue;

      updates.push({
        table: 'intake' as const,
        // The empty id itself, which is the only address the row has.
        legacyId: previous,
        column: 'intake_id',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
