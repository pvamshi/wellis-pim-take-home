import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import type { CatalogueRule, DuplicateFinding, RuleContext, RuleResponse } from '../rule-contract';

/**
 * D06 — two consent rows identical in patient, type, action, timestamp and
 * version: literal equality across all five, since the catalogue calls them
 * "identical", not merely alike.
 *
 * Not field-shaped and not ambiguous (1.1.13): a link changes no column of
 * either row, so nothing is proposed and no human is asked — the first row
 * holding a given combination, in table order, is the one the rest duplicate.
 *
 * `legacy_consent` carries no id but the patient's (1.0.4), so it is what both
 * sides of the link name — two rows sharing it is the log's normal shape, not
 * this finding. A row missing any of the five fields matches nothing here.
 *
 * Reads all five columns; an approved link stays untouched on a rerun.
 */
export const d06: CatalogueRule = {
  ruleId: 'D06',
  version: 1,
  ruleName: 'Two consent events are identical',
  description:
    'Two consent rows for the same patient carry the same type, action, timestamp and ' +
    'version — the same event recorded more than once. The earlier row, in the order ' +
    'this export lists them, is treated as the one the other duplicates.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const seen = new Set<string>();
    const duplicates: DuplicateFinding[] = [];

    for (const consent of consents) {
      const patientLegacyId = consent.legacyPatientId;
      const { type, action, at, version } = consent;
      if (type === null || action === null || at === null || version === null) continue;

      const key = JSON.stringify([patientLegacyId, type, action, at, version]);

      if (!seen.has(key)) {
        seen.add(key);
        continue;
      }

      // Both sides of the link are this same patient — the patient is part
      // of what must match for the rows to be identical in the first place.
      duplicates.push({
        table: 'consent' as const,
        duplicateLegacyId: patientLegacyId,
        canonicalLegacyId: patientLegacyId,
      });
    }

    return { ambiguity: false, updates: [], duplicates };
  },
};
