import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I36 — an intake's `outcome` holding a value that maps to none of the three
 * canonical results this column tracks: not a spelling I35 recognises, and
 * not empty.
 *
 * Ambiguous: `OK`, `declined`, `in review` and `open` each plainly mean
 * something, but which of approved, rejected or pending they mean is a
 * business call, not a lookup — a near-synonym is not a translation, and
 * guessing writes a result onto an intake record nobody confirmed (1.1.12).
 *
 * Tests `outcome` and reports against `outcome` (1.1.5); a value I35
 * recognises or an empty cell (I37's) is walked past, so a row a human
 * resolves by writing a recognised spelling in does not match again.
 */

/** The same five keys I35 canonicalises. A cell that folds to one of these is
 * recognised and is not this rule's finding. */
const RECOGNISED_SPELLINGS = new Set(['approved', 'goedgekeurd', 'rejected', 'afgewezen', 'pending']);

export const i36: CatalogueRule = {
  ruleId: 'I36',
  version: 1,
  ruleName: 'Intake outcome is a value nobody recognises',
  description:
    "This intake's outcome is a value the register cannot read as approved, rejected or " +
    'pending. The old system took this column as free text, and this cell holds something ' +
    'that reads as an answer but is not a spelling of one of the three results this column ' +
    'is meant to hold. Nothing is proposed, because turning it into one of the three would ' +
    'be a guess about a business decision nobody has made. A human decides which result it ' +
    'means, or writes it in some other form the register can hold.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.outcome;
      if (previous === null) continue; // I37's finding.

      const spelling = previous.trim().toLowerCase();
      if (spelling.length === 0) continue; // I37's finding.
      if (RECOGNISED_SPELLINGS.has(spelling)) continue; // I35's finding, or already canonical.

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'outcome',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
