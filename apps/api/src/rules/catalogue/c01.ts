import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * C01 — a consent's `patient_legacy_id` with whitespace around it. Proposes
 * the trimmed id.
 *
 * Not ambiguous: padding is the spreadsheet's, not part of the id it points
 * at, so trimming reads the cell rather than guessing at it. Trimmed away to
 * nothing is C03's finding, not this one's.
 *
 * A consent line carries no id of its own — `patient_legacy_id` is both the
 * column under test and this row's own address, so `legacyId` below is the
 * untrimmed value, as every id-holding rule addresses a row (1.1.5, 1.1.7).
 *
 * Tests and changes `patient_legacy_id`; the trimmed value has no padding
 * left, so an approved row does not match again.
 */
export const c01: CatalogueRule = {
  ruleId: 'C01',
  version: 1,
  ruleName: 'Consent patient id has whitespace around it',
  description:
    "This consent line's patient id has spaces around it. The trimmed id is proposed: " +
    'the same id, with the padding the old export left on it removed, so it matches the ' +
    'id the patient row itself is keyed by.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const updates = [];

    for (const consent of consents) {
      const previous = consent.legacyPatientId;
      const next = previous.trim();

      // Nothing left to address the row by. C03's finding, not this one's.
      if (next.length === 0) continue;

      // No padding to remove.
      if (next === previous) continue;

      updates.push({
        table: 'consent' as const,
        legacyId: previous,
        column: 'patient_legacy_id',
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
