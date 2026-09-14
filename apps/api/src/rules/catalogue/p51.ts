import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P51 — a patient's `height_cm` written in feet and inches: `5'10"`,
 * `5 ft 10`, and the word-form and quote-mark spellings between them.
 *
 * Not ambiguous: the shape names its own two numbers, feet and inches, and
 * the centimetre figure is arithmetic on them — nothing here for a human to
 * decide (1.1.12).
 *
 * Boundary: the shape is unique to this rule — a comma decimal is P49's, a
 * bare number is P50's or P53's — so nothing else on `height_cm` reads it.
 * Tests and changes `height_cm` (1.1.5); the proposal is a bare number, which
 * this rule's own pattern requires a foot or inch mark to match, so an
 * approved row does not match again.
 */

/** `5'10"`, `5 ft 10`, `5ft10in`, and the marks between them. */
const FEET_AND_INCHES =
  /^(\d{1,2})\s*(?:'|ft\.?)\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|in\.?)?$/i;

const CM_PER_FOOT = 30.48;
const CM_PER_INCH = 2.54;

/** Rounds to one decimal place and drops a trailing `.0`. */
function formatCm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export const p51: CatalogueRule = {
  ruleId: 'P51',
  version: 1,
  ruleName: 'Patient height is expressed in feet and inches',
  description:
    'This height is written in feet and inches rather than centimetres. The centimetre ' +
    'value is proposed: the feet and inches read off the cell, each converted at its own ' +
    'fixed rate and added together, the way a height in feet and inches always converts to ' +
    'centimetres.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.heightCm;
      if (previous === null) continue;

      const matched = FEET_AND_INCHES.exec(previous.trim());
      if (matched === null) continue;

      const feet = Number.parseFloat(matched[1] ?? '0');
      const inches = Number.parseFloat(matched[2] ?? '0');

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'height_cm',
        prev: previous,
        next: formatCm(feet * CM_PER_FOOT + inches * CM_PER_INCH),
      });
    }

    return { ambiguity: false, updates };
  },
};
