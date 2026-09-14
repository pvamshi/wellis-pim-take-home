import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P56 — a patient's `status` holding a value that maps to none of the four
 * canonical stages this column tracks: not a spelling P55 recognises, and not
 * empty.
 *
 * Ambiguous: `cancelled`, `opgezegd`, `lead`, `new` and `on hold` each plainly
 * mean something, but which of active, paused, churned or prospect they mean
 * is a business call, not a lookup — a near-synonym is not a translation, and
 * guessing writes a stage onto a patient record nobody confirmed (1.1.12).
 *
 * Tests `status` and reports against `status` (1.1.5); a value P55 recognises
 * or an empty cell (P57's) is walked past, so a row a human resolves by
 * writing a recognised spelling in does not match again.
 */

/** The same six keys P55 canonicalises. A cell that folds to one of these is
 * recognised and is not this rule's finding. */
const RECOGNISED_SPELLINGS = new Set(['active', 'actief', 'paused', 'gepauzeerd', 'churned', 'prospect']);

export const p56: CatalogueRule = {
  ruleId: 'P56',
  version: 1,
  ruleName: 'Patient status is a value nobody recognises',
  description:
    "This patient's status is a value the register cannot read as active, paused, " +
    'churned or prospect. The old system took this column as free text, and this cell ' +
    'holds something that reads as an answer but is not a spelling of one of the four ' +
    'stages this column is meant to hold. Nothing is proposed, because turning it into ' +
    'one of the four would be a guess about a business decision nobody has made. A human ' +
    'decides which stage it means, or writes it in some other form the register can hold.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.status;
      if (previous === null) continue; // P57's finding.

      const spelling = previous.trim().toLowerCase();
      if (spelling.length === 0) continue; // P57's finding.
      if (RECOGNISED_SPELLINGS.has(spelling)) continue; // P55's finding, or already canonical.

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'status',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
