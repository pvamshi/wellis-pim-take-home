import { Duplicate } from '../../duplicates/duplicate.entity';
import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * M01 — fills a patient's empty `full_name` from a confirmed duplicate.
 *
 * A link says X and Y are the same person (1.1.13); merging is an ordinary
 * rule row against Y, reusing 1.1.7 and 1.2.5 rather than a mechanism of its
 * own. Facts about the person merge (1.7.7) — `full_name` is one; a signup
 * fact like `status` or `source` is not, and gets no merge rule.
 *
 * Only `confirmed` links count — pending and dismissed are excluded by this
 * same read (1.7.3). Joined by the physical row id (`Duplicate.canonicalRowId`
 * / `duplicateRowId`), never by `legacyPatientId`: a legacy id does not
 * identify a row (1.0.3, 1.7.1).
 *
 * Two confirmed X's of one Y holding different `full_name` values propose
 * nothing for that row — conflicting evidence is not this rule's to resolve.
 * X's value is proposed exactly as it stands; cleaning it up is `full_name`'s
 * own rule (P03), not this one's (1.1.4).
 *
 * Not ambiguous: either every confirmed X agrees, and the answer is that
 * value, or they disagree, and nothing is proposed.
 */

function isEmpty(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

const COLUMN = 'full_name';

export const m01: CatalogueRule = {
  ruleId: 'M01',
  version: 1,
  ruleName: "Patient's full name can be filled from a confirmed duplicate",
  description:
    "A confirmed duplicate of this patient holds a full name and this row's own full name " +
    "is empty. That duplicate's value is proposed, unless more than one confirmed duplicate " +
    'holds a different name, in which case nothing is proposed.',
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

      const previous = y.fullName;
      if (!isEmpty(previous)) continue; // Already filled — left alone.

      const values = new Set<string>();
      for (const duplicateRowId of duplicateRowIds) {
        const x = byRowId.get(duplicateRowId);
        if (x === undefined) continue;
        if (!isEmpty(x.fullName)) values.add(x.fullName as string);
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
