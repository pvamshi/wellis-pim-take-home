import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * C11 — a consent row whose `at` is empty: missing outright, or holding
 * nothing but whitespace.
 *
 * Ambiguous: when an event happened is a fact this rule cannot derive from
 * the rest of the row — `type` and `action` say what happened, not when
 * (1.1.12).
 *
 * Boundary: any cell with real content, however malformed or out of range,
 * is C07 through C10's business — this rule sees no timestamp at all to
 * judge.
 *
 * Tests `at` and reports against it (1.1.5); a human writing the real
 * timestamp in is what keeps an approved row from matching again.
 */

function isEmpty(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const c11: CatalogueRule = {
  ruleId: 'C11',
  version: 1,
  ruleName: 'Consent at is empty',
  description:
    'This consent row has no timestamp — the column is empty, missing, or holds ' +
    'nothing but whitespace. Nothing else on the row says when the event happened, so ' +
    'no value is proposed here. Someone who can check the real event has to write the ' +
    'timestamp in.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const updates = [];

    for (const consent of consents) {
      const previous = consent.at;
      if (!isEmpty(previous)) continue;

      updates.push({
        table: 'consent' as const,
        legacyId: consent.legacyPatientId,
        column: 'at',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
