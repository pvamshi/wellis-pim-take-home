import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * C03 — a consent row whose `patient_legacy_id` is empty: holding nothing but
 * whitespace, or an empty string. The column is `NOT NULL`, so there is no
 * missing-column case to test for separately (compare P02).
 *
 * Ambiguous: which patient a consent line belongs to is a fact this rule
 * cannot derive from the rest of the row — `type`, `action` and `at` say
 * nothing about who it was for (1.1.12).
 *
 * Boundary: any cell with real content, however malformed or unmatched, is
 * C01's or C02's business — this rule sees no id at all to judge.
 *
 * Tests `patient_legacy_id`; a human writing the real patient id in is what
 * keeps an approved row from matching again.
 */
export const c03: CatalogueRule = {
  ruleId: 'C03',
  version: 1,
  ruleName: 'Consent patient id is empty',
  description:
    'This consent line has no patient id — the column is empty, or holds nothing but ' +
    'whitespace. Nothing else on the row says which patient it was for, so no id is ' +
    'proposed here. Someone who can check the real patient has to write it in.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const updates = [];

    for (const consent of consents) {
      const previous = consent.legacyPatientId;
      if (previous.trim().length !== 0) continue;

      updates.push({
        table: 'consent' as const,
        legacyId: previous,
        column: 'patient_legacy_id',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
