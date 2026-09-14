import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P48 — a patient's `weight_unit` naming no unit this export uses: not `kg`,
 * not `lbs`, and not one of the seven spellings P46 already maps to them.
 *
 * Ambiguous: the export uses exactly two units, and a word outside that set —
 * `pond`, a Dutch pound and not an English one, included — is not this rule's
 * to guess at (1.1.12).
 *
 * Boundary: empty is P47's finding; a spelling P46 already reads is P46's,
 * not this one's, however it is cased or padded.
 */

/** Every spelling this rule reads as a real unit, canonical or not. */
const KNOWN: ReadonlySet<string> = new Set([
  'kg',
  'kgs',
  'kilo',
  'kilogram',
  'lb',
  'lbs',
  'pounds',
]);

export const p48: CatalogueRule = {
  ruleId: 'P48',
  version: 1,
  ruleName: 'Patient weight unit is not recognised',
  description:
    "This patient's weight unit is not kilograms or pounds, or any recognised spelling of " +
    'either — the export uses exactly those two units, and this cell names neither one. A ' +
    'human needs to say what unit was meant before the weight beside it can be read at all.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every unit that is
   * neither empty nor a recognised spelling (1.1.14). Tests `weight_unit`;
   * reports against `weight_unit` (1.1.5), with no proposal since no unit is
   * certain.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.weightUnit;
      if (previous === null || previous.trim().length === 0) continue; // P47's finding.

      if (KNOWN.has(previous.trim().toLowerCase())) continue; // P46's finding, or clean already.

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'weight_unit',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
