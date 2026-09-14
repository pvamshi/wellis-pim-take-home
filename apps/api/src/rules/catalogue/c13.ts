import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * C13 — a consent row whose `version` is empty: missing outright, or
 * holding nothing but whitespace.
 *
 * Ambiguous: which consent text the patient actually saw is not on the row
 * anywhere else — `type`, `action` and `at` say what happened and when, not
 * which text version it was (1.1.12).
 *
 * Boundary: any cell with real content, however malformed or unrecognised,
 * is C12's business or out of scope for this batch — this rule sees no
 * version at all to judge.
 *
 * Tests `version` and reports against it (1.1.5); a human writing the real
 * version in is what keeps an approved row from matching again.
 */

function isEmpty(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const c13: CatalogueRule = {
  ruleId: 'C13',
  version: 1,
  ruleName: 'Consent version is empty',
  description:
    'This consent row has no version — the column is empty, missing, or holds nothing ' +
    'but whitespace. Nothing else on the row says which consent text the patient saw, so ' +
    'no value is proposed here. Someone who can check the real consent text has to write ' +
    'the version in.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const updates = [];

    for (const consent of consents) {
      const previous = consent.version;
      if (!isEmpty(previous)) continue;

      updates.push({
        table: 'consent' as const,
        legacyId: consent.legacyPatientId,
        column: 'version',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
