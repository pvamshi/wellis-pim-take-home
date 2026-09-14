import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I05 — an intake row whose `legacy_patient_id` is empty: missing outright,
 * or holding nothing but whitespace.
 *
 * Ambiguous: which patient an intake belongs to is a fact this rule cannot
 * derive from the rest of the row — nothing else on it says who submitted it
 * (1.1.12).
 *
 * Boundary: any cell with real content, however malformed or unmatched, is
 * I03's or I04's business — this rule sees no id at all to judge.
 *
 * Tests `legacy_patient_id` and reports against it (1.1.5); a human writing
 * the real patient id in is what keeps an approved row from matching again.
 */

function isEmpty(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const i05: CatalogueRule = {
  ruleId: 'I05',
  version: 1,
  ruleName: 'Intake patient reference is empty',
  description:
    "This intake row has no patient id — the column is empty, missing, or holds " +
    'nothing but whitespace. Nothing else on the row says which patient submitted it, so ' +
    'no id is proposed here. Someone who can check the real patient has to write it in.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.legacyPatientId;
      if (!isEmpty(previous)) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'legacy_patient_id',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
