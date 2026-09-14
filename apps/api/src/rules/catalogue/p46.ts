import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P46 — a patient's `weight_unit` written as a recognised but non-canonical
 * spelling of kilograms or pounds — `KG`, `kgs`, `kilo`, `Kilogram`, `lb`,
 * `lbs`, `pounds` — with the canonical spelling, `kg` or `lbs`, proposed.
 *
 * Not ambiguous: each spelling names exactly one of the two units the export
 * uses, so there is nothing for a human to decide (1.1.12).
 *
 * Boundary: already-canonical is nothing to propose; empty is P47's finding;
 * a spelling outside this list is P48's. Tests and changes `weight_unit`
 * (1.1.5); the canonical form is never itself one of the other spellings, so
 * an approved row does not match again.
 */

/** Every recognised spelling, lower-cased, mapped to the unit it canonicalises to. */
const CANONICAL: ReadonlyMap<string, string> = new Map([
  ['kg', 'kg'],
  ['kgs', 'kg'],
  ['kilo', 'kg'],
  ['kilogram', 'kg'],
  ['lb', 'lbs'],
  ['lbs', 'lbs'],
  ['pounds', 'lbs'],
]);

export const p46: CatalogueRule = {
  ruleId: 'P46',
  version: 1,
  ruleName: 'Patient weight unit is a recognised spelling',
  description:
    'The weight unit is a recognised spelling of kilograms or pounds, but not the spelling ' +
    'the column otherwise uses — KG, kgs, kilo and Kilogram all mean kilograms, and lb, lbs ' +
    'and pounds all mean pounds. The canonical spelling is proposed: the same unit, written ' +
    'the way the rest of the column writes it.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every unit spelled a
   * recognised but non-canonical way (1.1.14). Tests `weight_unit` and changes
   * `weight_unit` (1.1.5).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.weightUnit;
      if (previous === null) continue;

      const next = CANONICAL.get(previous.trim().toLowerCase());

      // Not one of the seven recognised spellings, or already canonical.
      // P47 and P48 read the rest.
      if (next === undefined || next === previous) continue;

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'weight_unit',
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
