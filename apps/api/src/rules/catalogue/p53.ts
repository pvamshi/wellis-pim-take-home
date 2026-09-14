import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P53 — a patient's `height_cm` that parses cleanly as a number, reads 3 or
 * above, and is still not a plausible human height: under 100 or over 250.
 *
 * Ambiguous: the number could be a typo, a unit mistake nothing else on the
 * row explains, or a real outlier, and nothing says which (1.1.12).
 *
 * Boundary: only a cell already clear of P49's comma and P51's feet-and-inches
 * reaches this check; a value under 3 reads as metres and is P50's fix, not
 * an implausible one.
 */

/** A clean, already-parseable height: digits, with at most one dot. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

const METRES_CEILING = 3;
const MIN_PLAUSIBLE = 100;
const MAX_PLAUSIBLE = 250;

export const p53: CatalogueRule = {
  ruleId: 'P53',
  version: 1,
  ruleName: 'Patient height is implausible after cleaning',
  description:
    'This height is under 100 or over 250, which is not a plausible human height in ' +
    'centimetres. The number itself is written cleanly and does not read as metres, so the ' +
    'formatting is not in question — someone needs to say whether it is a typo, a unit ' +
    'mistake, or a genuine outlier, because nothing on the row says which.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.heightCm;
      if (previous === null) continue;

      const trimmed = previous.trim();
      if (!PLAIN_NUMBER.test(trimmed)) continue; // P49's, P51's or P52's finding.

      const value = Number.parseFloat(trimmed);
      if (value < METRES_CEILING) continue; // P50's finding.
      if (value >= MIN_PLAUSIBLE && value <= MAX_PLAUSIBLE) continue;

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'height_cm',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
