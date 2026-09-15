import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, DuplicateFinding, RuleContext, RuleResponse } from '../rule-contract';

/**
 * D01 v2 — same catch as v1 (email match once normalised), now naming both
 * physical rows a link is between (1.7.1). v1 named the same legacy id on
 * both sides when the canonical row's id happened to match the current row's
 * id, which silently dropped a real duplicate whenever two distinct rows
 * shared a legacy id (1.0.3) and also matched on email — the self-guard now
 * compares row ids, the only thing that actually identifies a row.
 *
 * Re-implemented standalone rather than importing v1 (1.1.8): a version is
 * frozen code, and importing v1 would let an edit to it silently change v2.
 */

/** Ends trimmed, every letter lower case — P10's `normalised()`, read here. */
function normalisedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const d01V2: CatalogueRule = {
  ruleId: 'D01',
  version: 2,
  ruleName: 'Two patients share the same normalised email',
  description:
    'Two patient rows carry the same email address once trimmed and lower-cased — a ' +
    'sign the same person signed up more than once. The earlier row, in the order this ' +
    'export lists them, is treated as the one the other duplicates.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const canonicalByKey = new Map<string, { legacyId: string; rowId: string }>();
    const duplicates: DuplicateFinding[] = [];

    for (const patient of patients) {
      const previous = patient.email;
      if (previous === null) continue; // P15's finding, and nothing to match on.

      const trimmed = previous.trim();
      if (trimmed.length === 0) continue; // Same: nothing to match on.

      const key = normalisedEmail(previous);
      const canonical = canonicalByKey.get(key);

      if (canonical === undefined) {
        canonicalByKey.set(key, { legacyId: patient.legacyPatientId, rowId: patient.id });
        continue;
      }

      if (patient.id === canonical.rowId) continue; // Same physical row twice.

      duplicates.push({
        table: 'patient' as const,
        duplicateLegacyId: patient.legacyPatientId,
        duplicateRowId: patient.id,
        canonicalLegacyId: canonical.legacyId,
        canonicalRowId: canonical.rowId,
      });
    }

    return { ambiguity: false, updates: [], duplicates };
  },
};
