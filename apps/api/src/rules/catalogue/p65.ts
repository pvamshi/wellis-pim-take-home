import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P65 — a patient row whose `source` is empty: missing outright, or holding
 * nothing but whitespace.
 *
 * Ambiguous: `source` names which funnel brought the patient in, and that is
 * recorded by the old system, not derivable from `signup_date` or any other
 * column on the row (1.1.12).
 *
 * Boundary: any cell with real content, however it is spelled, is P64's
 * business and not this rule's — that rule sees a value to fold, this one
 * sees none.
 *
 * Tests `source` and reports against it (1.1.5); a human writing the real
 * source in is what keeps an approved row from matching again.
 */

function isEmpty(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const p65: CatalogueRule = {
  ruleId: 'P65',
  version: 1,
  ruleName: 'Patient source is empty',
  description:
    "This patient row has no source — the column is empty, missing, or holds nothing " +
    'but whitespace. Nothing else on the row says which funnel brought the patient in, ' +
    'so no value is proposed here. Someone who can check the real source has to write ' +
    'it in.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.source;
      if (!isEmpty(previous)) continue;

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'source',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
