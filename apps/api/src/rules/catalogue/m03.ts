import { Duplicate } from '../../duplicates/duplicate.entity';
import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * M03 — fills a patient's empty `dob` from a confirmed duplicate.
 *
 * Same shape as M01 for `full_name`: only `confirmed` links count (1.7.3),
 * joined by the physical row id, never `legacyPatientId` (1.0.3, 1.7.1). Two
 * confirmed X's holding different `dob` values propose nothing; X's value is
 * proposed exactly as it stands — parsing or normalising it is P16-P22's job,
 * not this one's (1.1.4).
 *
 * Not ambiguous: either every confirmed X agrees, or nothing is proposed.
 */

function isEmpty(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

const COLUMN = 'dob';

export const m03: CatalogueRule = {
  ruleId: 'M03',
  version: 1,
  ruleName: "Patient's date of birth can be filled from a confirmed duplicate",
  description:
    "A confirmed duplicate of this patient holds a date of birth and this row's own dob is " +
    "empty. That duplicate's value is proposed, unless more than one confirmed duplicate " +
    'holds a different dob, in which case nothing is proposed.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const links = await context.find(Duplicate);
    const patients = await context.find(LegacyPatient);

    const byRowId = new Map(patients.map((patient) => [patient.id, patient]));

    const confirmedByCanonical = new Map<string, Set<string>>();
    for (const link of links) {
      if (link.sourceTable !== 'patient' || link.status !== 'confirmed') continue;

      const duplicateRowIds = confirmedByCanonical.get(link.canonicalRowId);
      if (duplicateRowIds === undefined) {
        confirmedByCanonical.set(link.canonicalRowId, new Set([link.duplicateRowId]));
      } else {
        duplicateRowIds.add(link.duplicateRowId);
      }
    }

    const updates = [];

    for (const y of patients) {
      const duplicateRowIds = confirmedByCanonical.get(y.id);
      if (duplicateRowIds === undefined) continue; // No confirmed duplicate.

      const previous = y.dob;
      if (!isEmpty(previous)) continue; // Already filled — left alone.

      const values = new Set<string>();
      for (const duplicateRowId of duplicateRowIds) {
        const x = byRowId.get(duplicateRowId);
        if (x === undefined) continue;
        if (!isEmpty(x.dob)) values.add(x.dob as string);
      }

      if (values.size !== 1) continue; // Nothing to propose, or a conflict.

      const [next] = values;

      updates.push({
        table: 'patient' as const,
        legacyId: y.legacyPatientId,
        column: COLUMN,
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
