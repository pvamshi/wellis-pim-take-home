import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P67 — a patient's weight with an empty unit that only makes sense in pounds:
 * read against the row's `height_cm`, the number gives a believable BMI as
 * pounds and not as kilograms. Proposes the weight converted to kilograms, to
 * one decimal, and `kg` as the unit — P66's fix, for the row that never had
 * `lbs` written on it.
 *
 * Created alongside P47 v3 (1.5.2). P47 v2 proposed `kg` for every blank unit
 * and was declined: all 18 blank-unit weights in the export (140–320) give a
 * believable BMI only as pounds. Writing `kg` beside those numbers is wrong,
 * and so is writing `lbs` and leaving P66 to convert on a later run (one fix
 * making another rule match is not handled). This rule does the conversion in
 * one fix on two columns (1.1.4).
 *
 * Not ambiguous: the unit is settled by the weight, and a pound is exactly
 * 0.45359237 kg.
 *
 * Boundary: a row where the weight reads as kilograms is P47's; where both
 * readings are believable, or neither, it is left alone. A weight that is not a
 * plain number is P41–P43's, one outside 30–400 is P44's; a height that is not
 * a clean number in 100–250 is P49–P53's. A written unit is P46's or P66's.
 * Once approved the unit reads `kg`, so the row stops matching.
 */

/** A clean, already-parseable number: digits, with at most one dot. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

const MIN_WEIGHT = 30;
const MAX_WEIGHT = 400;
const MIN_HEIGHT_CM = 100;
const MAX_HEIGHT_CM = 250;

/** The band of adult BMI a weight must land in to be read in a given unit. */
const MIN_BELIEVABLE_BMI = 15;
const MAX_BELIEVABLE_BMI = 50;

const KG_PER_POUND = 0.45359237;

/** Empty, or holding nothing but whitespace. */
function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

/** A clean number inside [min, max], or null. */
function plainNumberWithin(value: string | null, min: number, max: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!PLAIN_NUMBER.test(trimmed)) return null;
  const parsed = Number.parseFloat(trimmed);
  return parsed >= min && parsed <= max ? parsed : null;
}

function isBelievableBmi(kilograms: number, heightCm: number): boolean {
  const metres = heightCm / 100;
  const bmi = kilograms / (metres * metres);
  return bmi >= MIN_BELIEVABLE_BMI && bmi <= MAX_BELIEVABLE_BMI;
}

export const p67: CatalogueRule = {
  ruleId: 'P67',
  version: 1,
  ruleName: 'Patient weight with an empty unit reads as pounds',
  description:
    "This patient's weight unit is missing, and read against the patient's height the weight " +
    'gives a believable BMI (15–50) only in pounds — in kilograms it would not. The weight ' +
    'converted to kilograms, to one decimal, is proposed together with kg as the unit, because ' +
    'changing one without the other would leave the row wrong.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns both columns of every
   * blank-unit weight that reads as pounds and not as kilograms (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      if (!isBlank(patient.weightUnit)) continue;

      const weight = plainNumberWithin(patient.weight, MIN_WEIGHT, MAX_WEIGHT);
      if (weight === null) continue;
      const heightCm = plainNumberWithin(patient.heightCm, MIN_HEIGHT_CM, MAX_HEIGHT_CM);
      if (heightCm === null) continue;

      const kilograms = weight * KG_PER_POUND;
      const asPounds = isBelievableBmi(kilograms, heightCm);
      const asKilograms = isBelievableBmi(weight, heightCm);
      if (!asPounds || asKilograms) continue; // Kilograms is P47's; both or neither, unsettled.

      updates.push(
        {
          table: 'patient' as const,
          legacyId: patient.legacyPatientId,
          column: 'weight',
          prev: patient.weight,
          next: (Math.round(kilograms * 10) / 10).toFixed(1),
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
