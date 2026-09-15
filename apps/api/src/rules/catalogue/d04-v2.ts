import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, DuplicateFinding, RuleContext, RuleResponse } from '../rule-contract';

/**
 * D04 v2 — same catch as v1 (phone match once normalised), now naming both
 * physical rows a link is between (1.7.1). Same fix as D01 v2: the
 * self-guard compares row ids instead of legacy ids, so two distinct rows
 * that share a legacy id (1.0.3) and also match on phone are linked rather
 * than silently dropped.
 *
 * Re-implemented standalone rather than importing v1 (1.1.8).
 */

/** Spaces, dots, dashes and brackets — P30's grouping, removed everywhere. */
const GROUPING = /[\s.()[\]-]/g;

/** Digits, with an optional single leading `+` — what P30 leaves behind. */
const DIGITS_WITH_OPTIONAL_LEADING_PLUS = /^\+?[0-9]+$/;

/** `00` then a non-zero digit — P31's exit prefix in front of a country code. */
const EXIT_PREFIX_THEN_COUNTRY_CODE = /^00[1-9]/;

/** `0` then a non-zero digit — P32's national Dutch trunk zero. */
const TRUNK_ZERO_THEN_NUMBER = /^0[1-9]/;

/** P30's strip, then P31's or P32's rewrite to a `+` country code. */
function normalisedPhone(value: string): string | null {
  const stripped = value.replace(GROUPING, '');
  if (stripped.length === 0 || !DIGITS_WITH_OPTIONAL_LEADING_PLUS.test(stripped)) return null;
  if (stripped.startsWith('+')) return stripped;
  if (EXIT_PREFIX_THEN_COUNTRY_CODE.test(stripped)) return `+${stripped.slice(2)}`;
  if (TRUNK_ZERO_THEN_NUMBER.test(stripped)) return `+31${stripped.slice(1)}`;
  return stripped;
}

export const d04V2: CatalogueRule = {
  ruleId: 'D04',
  version: 2,
  ruleName: 'Two patients share the same normalised phone',
  description:
    'Two patient rows carry the same phone number once grouping punctuation and country ' +
    'code notation are folded to one form — a sign the same person signed up more than ' +
    'once. The earlier row, in the order this export lists them, is treated as the one ' +
    'the other duplicates.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const canonicalByKey = new Map<string, { legacyId: string; rowId: string }>();
    const duplicates: DuplicateFinding[] = [];

    for (const patient of patients) {
      const previous = patient.phone;
      if (previous === null) continue; // Nothing to match on.

      const key = normalisedPhone(previous);
      if (key === null) continue; // Not a cell P30 through P32 can fold — P33's or P34's.

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
