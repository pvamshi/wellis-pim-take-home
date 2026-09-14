import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P44 — a patient's `weight` that parses cleanly as a number but is not a
 * plausible human weight in either unit: under 30 or over 400.
 *
 * Ambiguous: the number could be a typo, a misplaced decimal point, or a real
 * outlier, and nothing on the row says which (1.1.12).
 *
 * Boundary: only a cell already clear of P41's comma, P42's unit and P43's
 * unparseable shapes reaches this check, so 30–400 needs no unit column to
 * read against — it is implausible in kilograms and in pounds alike.
 */

/** A clean, already-parseable weight: digits, with at most one dot. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

const MIN_PLAUSIBLE = 30;
const MAX_PLAUSIBLE = 400;

export const p44: CatalogueRule = {
  ruleId: 'P44',
  version: 1,
  ruleName: 'Patient weight is implausible in either unit',
  description:
    'This weight is under 30 or over 400, which is not a plausible human weight whether the ' +
    'column is read in kilograms or in pounds. The number itself is written cleanly, so the ' +
    'formatting is not in question — someone needs to say whether it is a typo, a misplaced ' +
    'decimal point, or a genuine outlier, because nothing on the row says which.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every clean weight
   * outside the plausible range (1.1.14). Tests `weight`; reports against
   * `weight` (1.1.5), with no proposal since no correction is certain.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.weight;
      if (previous === null) continue;

      const trimmed = previous.trim();

      // Not a clean number: P41, P42 or P43 already own this cell (1.1.4).
      if (!PLAIN_NUMBER.test(trimmed)) continue;

      const value = Number.parseFloat(trimmed);
      if (value >= MIN_PLAUSIBLE && value <= MAX_PLAUSIBLE) continue;

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'weight',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
