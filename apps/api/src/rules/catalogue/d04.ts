import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, DuplicateFinding, RuleContext, RuleResponse } from '../rule-contract';

/**
 * D04 — two patient rows whose `phone` matches once normalised: P30's
 * grouping stripped, then P31's `00` or P32's trunk `0` rewritten to a `+`
 * country code, so `0612345678` and `+31612345678` are one number.
 *
 * Not field-shaped and not ambiguous (1.1.13): a link changes no column of
 * either row, so nothing is proposed and no human is asked — the first row
 * holding a given number, in table order, is the one the rest duplicate.
 *
 * A cell with a letter, an extension, or any mark none of P30 through P32
 * reads, matches nothing here — that cell's own rules, not this one.
 *
 * Reads `phone`; an approved link stays untouched on a rerun.
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

export const d04: CatalogueRule = {
  ruleId: 'D04',
  version: 1,
  ruleName: 'Two patients share the same normalised phone',
  description:
    'Two patient rows carry the same phone number once grouping punctuation and country ' +
    'code notation are folded to one form — a sign the same person signed up more than ' +
    'once. The earlier row, in the order this export lists them, is treated as the one ' +
    'the other duplicates.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const canonicalByKey = new Map<string, string>();
    const duplicates: DuplicateFinding[] = [];

    for (const patient of patients) {
      const previous = patient.phone;
      if (previous === null) continue; // Nothing to match on.

      const key = normalisedPhone(previous);
      if (key === null) continue; // Not a cell P30 through P32 can fold — P33's or P34's.

      const canonicalLegacyId = canonicalByKey.get(key);

      if (canonicalLegacyId === undefined) {
        canonicalByKey.set(key, patient.legacyPatientId);
        continue;
      }

      if (canonicalLegacyId === patient.legacyPatientId) continue; // Same row's own id twice.

      duplicates.push({
        table: 'patient' as const,
        duplicateLegacyId: patient.legacyPatientId,
        canonicalLegacyId,
      });
    }

    return { ambiguity: false, updates: [], duplicates };
  },
};
