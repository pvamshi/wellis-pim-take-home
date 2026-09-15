import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P47 v2 — same catch as v1 (a weight with no unit beside it), now proposing
 * `kg`: kilograms is the default unit (D6), so the row no longer waits on a
 * human to say which. No longer ambiguous.
 *
 * Re-implemented standalone rather than importing v1 (1.1.8): a version is
 * frozen code.
 */

/** Empty, or holding nothing but whitespace. */
function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const p47V2: CatalogueRule = {
  ruleId: 'P47',
  version: 2,
  ruleName: 'Patient weight unit is empty while weight has a value',
  description:
    "This patient's weight unit is missing while the weight column itself holds a value. " +
    'Kilograms is the default unit, so the rule proposes kg.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      if (!isBlank(patient.weightUnit)) continue;
      if (isBlank(patient.weight)) continue; // Nothing reported. P45's finding.

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'weight_unit',
        prev: patient.weightUnit,
        next: 'kg',
      });
    }

    return { ambiguity: false, updates };
  },
};
