import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P50 — a patient's `height_cm` that parses cleanly as a number but reads
 * under 3: nobody is 3cm tall, and every adult is well under 3m, so a value
 * this small was recorded in metres and is converted.
 *
 * Not ambiguous: under 3 has exactly one sane reading in a height column
 * (1.1.12). The conversion is arithmetic, not a guess — the same ×100 a
 * height in metres always takes to become centimetres.
 *
 * Boundary: only a cell already clear of P49's comma reaches this check, so
 * the number read here is already dot-decimal or a bare integer; a value at
 * 3 or above that is still implausible is P53's, and the feet-and-inches
 * shape is P51's, not this rule's to parse.
 */

/** A clean, already-parseable height: digits, with at most one dot. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

const METRES_CEILING = 3;

/** Rounds to one decimal place and drops a trailing `.0`. */
function formatCm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export const p50: CatalogueRule = {
  ruleId: 'P50',
  version: 1,
  ruleName: 'Patient height is expressed in metres',
  description:
    'This height reads under 3, which is not a plausible height in centimetres — it is a ' +
    'height recorded in metres instead. The centimetre value is proposed: the same figure, ' +
    'multiplied by 100, the way a height in metres always converts to centimetres.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.heightCm;
      if (previous === null) continue;

      const trimmed = previous.trim();
      if (!PLAIN_NUMBER.test(trimmed)) continue; // P49's or P52's finding.

      const value = Number.parseFloat(trimmed);
      if (value >= METRES_CEILING) continue;

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'height_cm',
        prev: previous,
        next: formatCm(value * 100),
      });
    }

    return { ambiguity: false, updates };
  },
};
