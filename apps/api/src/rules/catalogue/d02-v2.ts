import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, DuplicateFinding, RuleContext, RuleResponse } from '../rule-contract';

/**
 * D02 v2 — same catch as v1 (BSN match once cleaned), now naming both
 * physical rows a link is between (1.7.1). Same fix as D01 v2: the
 * self-guard compares row ids instead of legacy ids, so two distinct rows
 * that share a legacy id (1.0.3) and also match on BSN are linked rather
 * than silently dropped.
 *
 * Re-implemented standalone rather than importing v1 (1.1.8).
 */

/** Spaces, dots and dashes — P26's separators, removed wherever they fall. */
const SEPARATORS = /[\s.-]/g;

/** Digits, at least one, and nothing else — what cleaning must leave behind. */
const DIGITS_ONLY = /^[0-9]+$/;

/** P26's strip, then P27's zero-pad when eight digits are all that is left. */
function cleanedBsn(value: string): string | null {
  const stripped = value.replace(SEPARATORS, '');
  if (stripped.length === 0 || !DIGITS_ONLY.test(stripped)) return null;
  return stripped.length === 8 ? `0${stripped}` : stripped;
}

export const d02V2: CatalogueRule = {
  ruleId: 'D02',
  version: 2,
  ruleName: 'Two patients share the same BSN, once cleaned',
  description:
    'Two patient rows carry the same BSN once the grouping punctuation is stripped and a ' +
    'missing leading zero is restored — a sign the same person signed up more than once. ' +
    'The earlier row, in the order this export lists them, is treated as the one the ' +
    'other duplicates.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const canonicalByKey = new Map<string, { legacyId: string; rowId: string }>();
    const duplicates: DuplicateFinding[] = [];

    for (const patient of patients) {
      const previous = patient.bsn;
      if (previous === null) continue; // Nothing to match on.

      const key = cleanedBsn(previous);
      if (key === null) continue; // Not a cell cleaning turns into digits — P29's.

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
