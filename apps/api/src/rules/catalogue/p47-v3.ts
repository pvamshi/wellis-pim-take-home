import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P47 v3 — narrowed from v2. Still a weight with no unit beside it, still
 * proposing `kg`, but only where the weight itself says kilograms: read as
 * kilograms against the row's `height_cm` it gives a believable BMI, and read
 * as pounds it does not.
 *
 * v2 proposed `kg` for every blank unit and was declined: all 18 blank-unit
 * weights in the export (140–320) give a believable BMI only when read as
 * pounds. Those rows are P67's — the pounds conversion for a blank unit,
 * created alongside this version (1.5.2) — and not this rule's. One rule, one
 * fix (1.1.4): this rule writes `kg` beside an unchanged number, P67 converts
 * the number.
 *
 * Boundary: a row where both readings are believable, or neither is, or where
 * the weight or height is not a clean plausible number, is left alone — the
 * weight cannot settle the unit there. A weight that is not a plain number is
 * P41–P43's, one outside 30–400 is P44's; a height that is not a clean number
 * in 100–250 is P49–P53's. No weight is P45's.
 *
 * Re-implemented standalone rather than importing v1 or v2 (1.1.8): a version
 * is frozen code.
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

export const p47V3: CatalogueRule = {
  ruleId: 'P47',
  version: 3,
  ruleName: 'Patient weight unit is empty while weight has a value',
  description:
    "This patient's weight unit is missing while the weight column holds a value. Read against " +
    "the patient's height, the weight gives a believable BMI (15–50) only in kilograms — in " +
    'pounds it would not — so the rule proposes kg and leaves the number as it is.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every blank unit
   * whose weight reads as kilograms and not as pounds (1.1.14). Tests and
   * changes `weight_unit` (1.1.5); once approved the unit is `kg` and the row
   * stops matching.
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

      const asKilograms = isBelievableBmi(weight, heightCm);
      const asPounds = isBelievableBmi(weight * KG_PER_POUND, heightCm);
      if (!asKilograms || asPounds) continue; // Pounds is P67's; both or neither, unsettled.

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
