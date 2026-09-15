import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P66 — a patient's weight recorded in pounds: `weight_unit` is `lbs` beside a
 * plain, plausible `weight`. Proposes the weight in kilograms, to one decimal,
 * and `kg` as the unit.
 *
 * Not ambiguous: the unit is written on the row, and a pound is exactly
 * 0.45359237 kg, so there is nothing to guess.
 *
 * One fix on two columns (1.1.4): the number converted without the unit, or the
 * unit without the number, leaves the row wrong, so both are proposed together
 * and approved or declined together.
 *
 * Boundary: another spelling of pounds is P46's first; a weight that is not a
 * plain number is P41–P43's, and one outside 30–400 is P44's; an empty unit is
 * P47's. Once approved the unit reads `kg`, so the row stops matching.
 */

/** A clean, already-parseable weight: digits, with at most one dot. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

const MIN_PLAUSIBLE = 30;
const MAX_PLAUSIBLE = 400;

const KG_PER_POUND = 0.45359237;

export const p66: CatalogueRule = {
  ruleId: 'P66',
  version: 1,
  ruleName: 'Patient weight is recorded in pounds',
  description:
    'This weight is recorded in pounds. The weight converted to kilograms, to one decimal, is ' +
    'proposed together with kg as the unit, because changing one without the other would leave ' +
    'the row wrong.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns both columns of every
   * pounds weight it can convert (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      if (patient.weightUnit !== 'lbs' || patient.weight === null) continue;

      const trimmed = patient.weight.trim();
      if (!PLAIN_NUMBER.test(trimmed)) continue;

      const pounds = Number.parseFloat(trimmed);
      if (pounds < MIN_PLAUSIBLE || pounds > MAX_PLAUSIBLE) continue;

      const kilograms = (Math.round(pounds * KG_PER_POUND * 10) / 10).toFixed(1);

      updates.push(
        {
          table: 'patient' as const,
          legacyId: patient.legacyPatientId,
          column: 'weight',
          prev: patient.weight,
          next: kilograms,
        },
        {
          table: 'patient' as const,
          legacyId: patient.legacyPatientId,
          column: 'weight_unit',
          prev: patient.weightUnit,
          next: 'kg',
        },
      );
    }

    return { ambiguity: false, updates };
  },
};
