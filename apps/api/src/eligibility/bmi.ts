/**
 * Rounds half up to `decimals` places, nudging by `Number.EPSILON` first so a
 * value whose exact binary representation sits a hair under the true half
 * (`2.675 * 100 === 267.49999999999994`, not `267.5`) still rounds the way a
 * person reading the decimal digits would expect.
 */
export function roundHalfUp(value: number, decimals: number): number {
  const factor = 10 ** decimals;

  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * BMI, rounded half-up to 1 dp (2.5, 2.7): `weight_kg / (height_cm / 100)²`.
 *
 * Compared *rounded* everywhere it is used (2.7) — 26.96 must read as 27.0 and
 * clear E2, not reject as 26.96 — so this is the one function both the
 * eligibility rules and whichever service later stores `patient.bmi` call,
 * rather than each rounding its own copy of the formula.
 */
export function computeBmi(heightCm: number, weightKg: number): number {
  const heightMeters = heightCm / 100;

  return roundHalfUp(weightKg / heightMeters ** 2, 1);
}

/** `27.0`, `28.6` — a rounded BMI's own digit always shows, which `String(bmi)` would drop for a whole number. */
/** BMI, or null when a legacy import is missing height or weight (2.7: E2 rejects it). */
export function bmiOf(heightCm: number | null, weightKg: number | null): number | null {
  return heightCm === null || weightKg === null ? null : computeBmi(heightCm, weightKg);
}

export function formatBmi(bmi: number): string {
  return bmi.toFixed(1);
}
