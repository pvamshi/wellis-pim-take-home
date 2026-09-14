import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * C05 — a consent's `action` written in a spelling this export is known to
 * use for one of the two canonical results — `granted`/`verleend`,
 * `revoked`/`ingetrokken` — in any case, where that spelling is not already
 * canonical.
 *
 * Not ambiguous: each spelling below names one result and only one, in
 * English or in Dutch, so reading it is a lookup rather than a guess
 * (1.1.12). A value neither name fits is C06's refusal, not this rule's.
 *
 * Tests and changes `action`; the canonical value carries none of the
 * recognised spellings, so an approved row does not match again.
 */

/**
 * Every spelling this rule recognises, lower-cased, and the canonical value
 * it stands for — the English word each result already appears as in the
 * export, and the Dutch word consent language uses for the same result.
 */
const CANONICAL_SPELLINGS = new Map<string, string>([
  ['granted', 'granted'],
  ['verleend', 'granted'],
  ['revoked', 'revoked'],
  ['ingetrokken', 'revoked'],
]);

export const c05: CatalogueRule = {
  ruleId: 'C05',
  version: 1,
  ruleName: 'Consent action is a recognised spelling that is not canonical',
  description:
    "This consent's action is written in a spelling the old system used for one of the " +
    'two results this column tracks — granted or revoked, in English or in Dutch, in any ' +
    'case — rather than in the canonical form. The same result, written canonically, is ' +
    'proposed. A value neither name fits is not touched here, and nothing is guessed.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const updates = [];

    for (const consent of consents) {
      const previous = consent.action;
      if (previous === null) continue; // Not this rule's business; C06's territory.

      const canonical = CANONICAL_SPELLINGS.get(previous.trim().toLowerCase());
      if (canonical === undefined) continue; // C06's finding.
      if (canonical === previous) continue; // Already exactly canonical.

      updates.push({
        table: 'consent' as const,
        legacyId: consent.legacyPatientId,
        column: 'action',
        prev: previous,
        next: canonical,
      });
    }

    return { ambiguity: false, updates };
  },
};
