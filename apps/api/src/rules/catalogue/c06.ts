import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * C06 — a consent's `action` that is neither a canonical result nor one of
 * C05's recognised spellings for one: missing, blank, or text this export
 * carries no rule for at all.
 *
 * Ambiguous: nothing on the row says whether the real result was granted or
 * revoked, or something this migration has no record of (1.1.12) — a human
 * reads the actual text and decides.
 *
 * Boundary: a value C05 already reads as a spelling of granted or revoked is
 * its fix, not this rule's finding.
 *
 * Tests `action`; a human writing in `granted` or `revoked` is what keeps an
 * approved row from matching again.
 */

/** The same lookup C05 rewrites from — every spelling this export is known
 * to use for one of the two results. Not recognised here is this rule's
 * whole finding. */
const CANONICAL_SPELLINGS = new Map<string, string>([
  ['granted', 'granted'],
  ['verleend', 'granted'],
  ['revoked', 'revoked'],
  ['ingetrokken', 'revoked'],
]);

export const c06: CatalogueRule = {
  ruleId: 'C06',
  version: 1,
  ruleName: 'Consent action is neither granted nor revoked',
  description:
    "This consent's action is neither granted nor revoked, in any spelling this export " +
    'is known to use for either result — it may be missing, blank, or text the migration ' +
    'has no record of. Someone who can check the real event has to say whether it was a ' +
    'grant or a revocation.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const updates = [];

    for (const consent of consents) {
      const previous = consent.action;
      const recognised = previous !== null && CANONICAL_SPELLINGS.has(previous.trim().toLowerCase());
      if (recognised) continue; // C05's fix.

      updates.push({
        table: 'consent' as const,
        legacyId: consent.legacyPatientId,
        column: 'action',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
