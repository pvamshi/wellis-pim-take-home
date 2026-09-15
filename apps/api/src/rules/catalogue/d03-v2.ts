import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, DuplicateFinding, RuleContext, RuleResponse } from '../rule-contract';

/**
 * D03 v2 — same catch as v1 (name folded, dob exact), now naming both
 * physical rows a link is between (1.7.1). Same fix as D01 v2: the
 * self-guard compares row ids instead of legacy ids, so two distinct rows
 * that share a legacy id (1.0.3) and also match on name and dob are linked
 * rather than silently dropped.
 *
 * Re-implemented standalone rather than importing v1 (1.1.8).
 */

/** Runs of whitespace, one or more characters, collapsed to a single space. */
const WHITESPACE_RUN = /\s+/g;

/** Ends trimmed, internal whitespace collapsed, every letter lower case. */
function foldedName(value: string): string {
  return value.trim().replace(WHITESPACE_RUN, ' ').toLowerCase();
}

export const d03V2: CatalogueRule = {
  ruleId: 'D03',
  version: 2,
  ruleName: 'Two patients share the same normalised name and dob',
  description:
    'Two patient rows carry the same full name once whitespace and case differences are ' +
    'folded away, and an identical date of birth — a sign the same person signed up more ' +
    'than once. The earlier row, in the order this export lists them, is treated as the ' +
    'one the other duplicates.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const canonicalByKey = new Map<string, { legacyId: string; rowId: string }>();
    const duplicates: DuplicateFinding[] = [];

    for (const patient of patients) {
      const name = patient.fullName;
      const dob = patient.dob;
      if (name === null || dob === null) continue; // Nothing to match on.

      const foldedFullName = foldedName(name);
      const trimmedDob = dob.trim();
      if (foldedFullName.length === 0 || trimmedDob.length === 0) continue;

      // JSON-encoded pair rather than a joined string, so a name and a dob
      // that happen to abut differently can never collide into one key.
      const key = JSON.stringify([foldedFullName, trimmedDob]);
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
