import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P47 — a patient row with a `weight` but no `weight_unit`: the unit cell is
 * empty, or holds nothing but whitespace, while the weight beside it does not.
 *
 * Ambiguous: the export notes say the unit column was backfilled only "where
 * obvious", and this is a row it left behind — nothing says kilograms or
 * pounds, so this rule proposes nothing (1.1.12).
 *
 * Reads `weight` to decide the row has something to be unitless about, but
 * tests and changes `weight_unit` (1.1.5) — a row with neither value is
 * P45's alone.
 */

/** Empty, or holding nothing but whitespace. */
function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const p47: CatalogueRule = {
  ruleId: 'P47',
  version: 1,
  ruleName: 'Patient weight unit is empty while weight has a value',
  description:
    "This patient's weight unit is missing while the weight column itself holds a value. " +
    'The unit column was added to the export late and backfilled only "where obvious", and ' +
    'this row is one the backfill left behind — nothing on the row says whether the weight ' +
    'is in kilograms or in pounds, so someone has to say which.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every row whose unit
   * is blank while its weight is not (1.1.14). Tests `weight_unit`; reports
   * against `weight_unit` (1.1.5), with no proposal since no unit is certain.
   */
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
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
