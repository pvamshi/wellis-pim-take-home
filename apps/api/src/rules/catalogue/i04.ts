import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I04 — an intake's `legacy_patient_id` that names no row in `legacy_patient`
 * at all: a broken reference, not a bad value.
 *
 * Ambiguous: EXPORT-NOTES says the intake automation sometimes fired before
 * the patient row existed, so a dangling reference is expected of some rows
 * and not a typo this rule can guess a correction for — only a human can say
 * which patient it was, or that none was ever created (1.1.12).
 *
 * Boundary: a blank reference is I05's finding and a padded one is I03's;
 * both are skipped here, since neither has a real id yet to look up.
 *
 * Tests `legacy_patient_id` and reports against it (1.1.5); a human writing
 * in an id that exists is what keeps an approved row from matching again.
 */
export const i04: CatalogueRule = {
  ruleId: 'I04',
  version: 1,
  ruleName: 'Intake references a patient that does not exist',
  description:
    "This intake's patient id does not match any patient row in the export. The " +
    'automation that wrote intakes sometimes ran before the matching patient row did, so ' +
    'this can be expected rather than a typo — someone who knows the real patient has to ' +
    'say who it was, or that the row has no match at all.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const patients = await context.find(LegacyPatient);
    const knownPatientIds = new Set(patients.map((patient) => patient.legacyPatientId));
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.legacyPatientId;

      // No reference to check yet. I05's finding.
      if (previous === null || previous.trim().length === 0) continue;

      // Padding around an otherwise real id is I03's fix, and this rule
      // would misjudge a match hidden under it — hand the row on unread.
      if (previous !== previous.trim()) continue;

      if (knownPatientIds.has(previous)) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'legacy_patient_id',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
