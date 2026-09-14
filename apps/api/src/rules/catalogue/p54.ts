import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P54 — a patient row with no `height_cm` at all: the cell is null, or holds
 * nothing but whitespace.
 *
 * Ambiguous: nothing else on the row says what the height was, so this rule
 * reports and proposes nothing (1.1.12).
 *
 * Boundary: every other rule on `height_cm` — P49 through P53 — needs
 * something in the cell to read, and walks past a blank one; this rule is the
 * one that catches it.
 */

/** Empty, or holding nothing but whitespace. */
function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const p54: CatalogueRule = {
  ruleId: 'P54',
  version: 1,
  ruleName: 'Patient height is empty',
  description:
    "This patient's height is missing — the column is empty, or holds nothing but " +
    'whitespace. Nothing else on the row says what it was, so someone has to say how tall ' +
    'this patient is, in centimetres, or that it is not known.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.heightCm;
      if (!isBlank(previous)) continue;

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
