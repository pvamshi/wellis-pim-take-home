import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P45 — a patient row with no `weight` at all: the cell is null, or holds
 * nothing but whitespace.
 *
 * Ambiguous: a weight is self-reported and nothing else on the row says what
 * it was, so this rule reports and proposes nothing (1.1.12).
 *
 * Boundary: every other rule on `weight` — P41 through P44 — needs something
 * in the cell to read, and walks past a blank one; this rule is the one that
 * catches it.
 */

/** Empty, or holding nothing but whitespace. */
function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const p45: CatalogueRule = {
  ruleId: 'P45',
  version: 1,
  ruleName: 'Patient weight is empty',
  description:
    "This patient's weight is missing — the column is empty, or holds nothing but " +
    'whitespace. A weight is self-reported at submission time and nothing else on the row ' +
    'says what it was, so someone has to say what this patient weighs, or that it is not ' +
    'known.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every row with no
   * weight (1.1.14). Tests `weight`; reports against `weight` (1.1.5), with no
   * proposal since there is no value here to infer.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.weight;
      if (!isBlank(previous)) continue;

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
