import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * C04 — a consent's `type` that is not exactly `data_processing`: missing,
 * blank, padded, a different case, a typo, or a genuinely different type.
 * EXPORT-NOTES documents only that one value, so no companion rule sorts
 * these cases apart — this rule owns all of them.
 *
 * Ambiguous: nothing says whether a deviation is export noise or a second
 * consent type nobody documented, so no value is proposed for any of them
 * (1.1.12) — a human reads the actual text and decides.
 *
 * Tests `type`; a human writing in `data_processing`, or confirming the row
 * really is a different type, is what keeps an approved row from matching
 * again.
 */
export const c04: CatalogueRule = {
  ruleId: 'C04',
  version: 1,
  ruleName: 'Consent type is not data_processing',
  description:
    "This consent's type is not `data_processing`, the only consent type the export " +
    'notes document — it may be missing, padded, a different case or spelling, or a ' +
    'genuinely different type the migration has no record of. Someone who can check the ' +
    'real value has to say whether it means data_processing or something else entirely.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const updates = [];

    for (const consent of consents) {
      const previous = consent.type;
      if (previous === 'data_processing') continue;

      updates.push({
        table: 'consent' as const,
        legacyId: consent.legacyPatientId,
        column: 'type',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
