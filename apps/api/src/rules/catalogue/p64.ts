import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P64 — a patient's `source` with whitespace around it, or written in a
 * casing that does not match the rest of the column. Proposes the same
 * value trimmed and lower-cased.
 *
 * Not ambiguous: `source` names a funnel from a short, known set — `Web `,
 * `REFERRAL` and `referral` name the same funnel, so folding the spelling
 * reads the cell rather than guessing at it (1.1.12).
 *
 * Boundary: a cell that trims away to nothing is P65's finding, not this
 * one's — this rule proposes a value, and an empty string is not one.
 *
 * Tests `source` and changes `source` (1.1.5); the fixed value carries no
 * padding or uppercase, so an approved row does not match again.
 */

export const p64: CatalogueRule = {
  ruleId: 'P64',
  version: 1,
  ruleName: 'Patient source has whitespace or inconsistent casing',
  description:
    "This patient's source has whitespace around it, or is written in a different case " +
    'than the rest of the column. The same value, trimmed and lower-cased, is proposed: ' +
    'the same funnel, spelled the way every other row spells it.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.source;
      if (previous === null) continue;

      const next = previous.trim().toLowerCase();

      // Trims away to nothing. P65's finding, not this one's.
      if (next.length === 0) continue;

      // Already trimmed and lower-cased — nothing to fix.
      if (next === previous) continue;

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'source',
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
