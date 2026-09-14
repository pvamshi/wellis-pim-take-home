import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, DuplicateFinding, RuleContext, RuleResponse } from '../rule-contract';

/**
 * D03 — two patient rows whose `full_name` matches once folded (trimmed,
 * whitespace collapsed, lower-cased) and whose `dob` cell matches exactly.
 *
 * Not field-shaped and not ambiguous (1.1.13): a link changes no column of
 * either row, so nothing is proposed and no human is asked — the first row
 * holding a given name and dob, in table order, is the one the rest
 * duplicate.
 *
 * `dob` is read as stored, not reparsed — the catalogue asks for "the same
 * dob", not a normalised one, so two spellings of one date are the `dob`
 * column's own business, not this rule's.
 *
 * Reads `full_name` and `dob`; an approved link stays untouched on a rerun.
 */

/** Runs of whitespace, one or more characters, collapsed to a single space. */
const WHITESPACE_RUN = /\s+/g;

/** Ends trimmed, internal whitespace collapsed, every letter lower case. */
function foldedName(value: string): string {
  return value.trim().replace(WHITESPACE_RUN, ' ').toLowerCase();
}

export const d03: CatalogueRule = {
  ruleId: 'D03',
  version: 1,
  ruleName: 'Two patients share the same normalised name and dob',
  description:
    'Two patient rows carry the same full name once whitespace and case differences are ' +
    'folded away, and an identical date of birth — a sign the same person signed up more ' +
    'than once. The earlier row, in the order this export lists them, is treated as the ' +
    'one the other duplicates.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const canonicalByKey = new Map<string, string>();
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
