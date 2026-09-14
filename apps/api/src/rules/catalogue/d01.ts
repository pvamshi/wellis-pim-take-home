import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, DuplicateFinding, RuleContext, RuleResponse } from '../rule-contract';

/**
 * D01 — two patient rows whose `email` matches once normalised: ends
 * trimmed, every letter lower-cased — P10's fold, read here rather than
 * written (1.1.2).
 *
 * Not field-shaped and not ambiguous (1.1.13): a link changes no column of
 * either row, so nothing is proposed and no human is asked — the first row
 * holding a given address, in table order, is the one the rest duplicate.
 *
 * An empty address matches nothing here — P15's finding — and this rule
 * does not judge whether an address is well-formed, only whether two rows
 * read the same after folding.
 *
 * Reads `email`; an approved link stays untouched on a rerun.
 */

/** Ends trimmed, every letter lower case — P10's `normalised()`, read here. */
function normalisedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const d01: CatalogueRule = {
  ruleId: 'D01',
  version: 1,
  ruleName: 'Two patients share the same normalised email',
  description:
    'Two patient rows carry the same email address once trimmed and lower-cased — a ' +
    'sign the same person signed up more than once. The earlier row, in the order this ' +
    'export lists them, is treated as the one the other duplicates.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const canonicalByKey = new Map<string, string>();
    const duplicates: DuplicateFinding[] = [];

    for (const patient of patients) {
      const previous = patient.email;
      if (previous === null) continue; // P15's finding, and nothing to match on.

      const trimmed = previous.trim();
      if (trimmed.length === 0) continue; // Same: nothing to match on.

      const key = normalisedEmail(previous);
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
