import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * C02 — a consent's `patient_legacy_id` that names no row in `legacy_patient`
 * at all: a broken reference, not a bad value.
 *
 * Ambiguous: a dangling consent, like a dangling intake (I04), can be an
 * import-order artefact rather than a typo — only a human can say which
 * patient it was, or that none exists (1.1.12).
 *
 * Boundary: an empty reference is C03's finding and a padded one is C01's;
 * both are skipped, since neither has a real id yet to look up — and as in
 * C01, `legacyId` below is the id exactly as it stood before the lookup.
 *
 * Tests `patient_legacy_id`; a human writing in an id that exists is what
 * keeps an approved row from matching again.
 */
export const c02: CatalogueRule = {
  ruleId: 'C02',
  version: 1,
  ruleName: 'Consent references a patient that does not exist',
  description:
    "This consent line's patient id does not match any patient row in the export. This " +
    'can be an import-order artefact rather than a typo, the same as it can be for an ' +
    'intake — someone who knows the real patient has to say who it was, or that the row ' +
    'has no match at all.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const patients = await context.find(LegacyPatient);
    const knownPatientIds = new Set(patients.map((patient) => patient.legacyPatientId));
    const updates = [];

    for (const consent of consents) {
      const previous = consent.legacyPatientId;

      // No reference to check yet. C03's finding.
      if (previous.trim().length === 0) continue;

      // Padding around an otherwise real id is C01's fix, and this rule
      // would misjudge a match hidden under it — hand the row on unread.
      if (previous !== previous.trim()) continue;

      if (knownPatientIds.has(previous)) continue;

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
