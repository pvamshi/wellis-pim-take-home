import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P57 — a patient row with no `status` at all: the cell absent, empty, or
 * holding nothing but whitespace.
 *
 * Ambiguous: nothing else in the row states a stage — `source` names the
 * signup funnel and `signup_date` a date, neither says whether the patient is
 * active, paused, churned or prospect — and there is no safe default among
 * four answers where guessing writes a stage nobody confirmed (1.1.12).
 *
 * Tests `status` and reports against `status` (1.1.5); a cell P55 or P56
 * would read is walked past, so a row a human writes an answer into does not
 * match again.
 */

/** True when the cell holds no value: absent, empty, or nothing but whitespace. */
function isMissing(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const p57: CatalogueRule = {
  ruleId: 'P57',
  version: 1,
  ruleName: 'Patient status is empty',
  description:
    'This patient row has no status — the column is empty, or holds nothing but ' +
    'whitespace. Nothing else in the row says whether the patient is active, paused, ' +
    'churned or prospect, and there is no safe default among the four to assume. A human ' +
    'finds out which stage applies and writes it in, or decides the blank is correct and ' +
    'leaves it.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.status;
      if (!isMissing(previous)) continue; // P55's or P56's finding.

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'status',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
