import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import type { CatalogueRule, DuplicateFinding, RuleContext, RuleResponse } from '../rule-contract';

/**
 * D06 v2 — same catch as v1 (five fields identical), now naming both
 * physical rows a link is between (1.7.1). Both sides of a link keep the
 * same patient legacy id — that is part of what must match — but v1 left
 * the two consent rows themselves unidentifiable; v2 adds each row's own
 * generated `id`.
 *
 * Re-implemented standalone rather than importing v1 (1.1.8).
 */
export const d06V2: CatalogueRule = {
  ruleId: 'D06',
  version: 2,
  ruleName: 'Two consent events are identical',
  description:
    'Two consent rows for the same patient carry the same type, action, timestamp and ' +
    'version — the same event recorded more than once. The earlier row, in the order ' +
    'this export lists them, is treated as the one the other duplicates.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const canonicalRowIdByKey = new Map<string, string>();
    const duplicates: DuplicateFinding[] = [];

    for (const consent of consents) {
      const patientLegacyId = consent.legacyPatientId;
      const { type, action, at, version } = consent;
      if (type === null || action === null || at === null || version === null) continue;

      const key = JSON.stringify([patientLegacyId, type, action, at, version]);
      const canonicalRowId = canonicalRowIdByKey.get(key);

      if (canonicalRowId === undefined) {
        canonicalRowIdByKey.set(key, consent.id);
        continue;
      }

      // Both sides of the link are this same patient — the patient is part
      // of what must match for the rows to be identical in the first place.
      duplicates.push({
        table: 'consent' as const,
        duplicateLegacyId: patientLegacyId,
        duplicateRowId: consent.id,
        canonicalLegacyId: patientLegacyId,
        canonicalRowId,
      });
    }

    return { ambiguity: false, updates: [], duplicates };
  },
};
