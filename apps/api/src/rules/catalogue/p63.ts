import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P63 — a patient row whose `signup_date` is empty: missing outright, or
 * holding nothing but whitespace.
 *
 * Ambiguous: a signup date is a fact about what happened, not something this
 * rule can derive from the rest of the row — `dob`, `source` and every other
 * column are silent on when the patient signed up (1.1.12).
 *
 * Boundary: any cell with real content, however malformed, is P58 through
 * P62's business and not this rule's — those rules see a value to judge, this
 * one sees none.
 *
 * Tests `signup_date` and reports against it (1.1.5); a human writing the
 * real signup date in is what keeps an approved row from matching again.
 */

function isEmpty(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const p63: CatalogueRule = {
  ruleId: 'P63',
  version: 1,
  ruleName: 'Patient signup date is empty',
  description:
    "This patient row has no signup date — the column is empty, missing, or holds " +
    'nothing but whitespace. Nothing else on the row says when the patient actually ' +
    'signed up, so no date is proposed here. Someone who can check the real signup date ' +
    'has to write it in, year-month-day.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.signupDate;
      if (!isEmpty(previous)) continue;

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'signup_date',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
