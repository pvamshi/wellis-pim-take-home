import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P52 — a patient's `height_cm` that is not a number at all: prose, a grouped
 * or double comma, or any shape a number reader cannot parse.
 *
 * Ambiguous: there is no single reading to propose, so this rule reports and
 * proposes nothing (1.1.12).
 *
 * Boundary against `height_cm`'s other rules: a clean decimal comma is P49's,
 * feet and inches is P51's, an empty cell is P54's — this rule is what is
 * left once those three, and a clean parseable number, are ruled out. A clean
 * number that is merely out of range is P50's or P53's, not this one's.
 */

/** A clean, already-parseable height: digits, with at most one dot. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

/** P49's decimal comma, duplicated so this rule can walk past its finds. */
const COMMA_DECIMAL = /\d,\d{1,2}(?!\d)/;

/** P51's feet-and-inches shape, duplicated so this rule can walk past its finds. */
const FEET_AND_INCHES =
  /^(\d{1,2})\s*(?:'|ft\.?)\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|in\.?)?$/i;

/** True when P49 or P51 already has a clean, unambiguous fix for this cell. */
function readByANeighbour(trimmed: string): boolean {
  const isCommaDecimal =
    !trimmed.includes('.') &&
    trimmed.indexOf(',') === trimmed.lastIndexOf(',') &&
    COMMA_DECIMAL.test(trimmed);
  if (isCommaDecimal) return true;

  return FEET_AND_INCHES.test(trimmed);
}

export const p52: CatalogueRule = {
  ruleId: 'P52',
  version: 1,
  ruleName: 'Patient height is not a number',
  description:
    'This height does not read as a number at all — not a plain figure, not a comma ' +
    'decimal, not feet and inches, just something a number reader cannot parse. A height is ' +
    'only ever read as a number, and there is no single reading to propose here, so someone ' +
    'has to say what this cell was meant to hold.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.heightCm;
      if (previous === null) continue;

      const trimmed = previous.trim();
      if (trimmed.length === 0) continue; // P54's finding.

      if (PLAIN_NUMBER.test(trimmed)) continue;
      if (readByANeighbour(trimmed)) continue;

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
