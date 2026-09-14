import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, DuplicateFinding, RuleContext, RuleResponse } from '../rule-contract';

/**
 * D02 — two patient rows whose `bsn` matches once cleaned: P26's separators
 * stripped, then P27's leading zero restored to an eight-digit result —
 * read here rather than written (1.1.2).
 *
 * Not field-shaped and not ambiguous (1.1.13): a link changes no column of
 * either row, so nothing is proposed and no human is asked — the first row
 * holding a given number, in table order, is the one the rest duplicate.
 *
 * A cell with no digits, or with a character neither cleaning removes,
 * matches nothing here — P29's finding, not a number for this rule to
 * guess at.
 *
 * Reads `bsn`; an approved link stays untouched on a rerun.
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

export const d02: CatalogueRule = {
  ruleId: 'D02',
  version: 1,
  ruleName: 'Two patients share the same BSN, once cleaned',
  description:
    'Two patient rows carry the same BSN once the grouping punctuation is stripped and a ' +
    'missing leading zero is restored — a sign the same person signed up more than once. ' +
    'The earlier row, in the order this export lists them, is treated as the one the ' +
    'other duplicates.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const canonicalByKey = new Map<string, string>();
    const duplicates: DuplicateFinding[] = [];

    for (const patient of patients) {
      const previous = patient.bsn;
      if (previous === null) continue; // Nothing to match on.

      const key = cleanedBsn(previous);
      if (key === null) continue; // Not a cell cleaning turns into digits — P29's.

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
