import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I35 — an intake's `outcome` written in a spelling this export is known to
 * use for one of the three canonical results — `approved`/`goedgekeurd`,
 * `rejected`/`afgewezen`, `pending` — where that spelling is not already
 * canonical.
 *
 * Not ambiguous: each spelling below names one result and only one, in
 * English or Dutch, so reading it is a lookup, not a guess (1.1.12). A
 * near-synonym nobody recognises — `OK`, `declined`, `in review` — is I36's
 * refusal, not this rule's business; an empty cell is I37's.
 *
 * Tests and changes `outcome` (1.1.5); the canonical value carries none of
 * the recognised spellings, so an approved row does not match again.
 */

/**
 * Every spelling this rule recognises, lower-cased, and the canonical value
 * it stands for — the English word each of the three results already
 * appears as somewhere in the export, and the Dutch word where the export
 * uses one.
 */
const CANONICAL_SPELLINGS = new Map<string, string>([
  ['approved', 'approved'],
  ['goedgekeurd', 'approved'],
  ['rejected', 'rejected'],
  ['afgewezen', 'rejected'],
  ['pending', 'pending'],
]);

export const i35: CatalogueRule = {
  ruleId: 'I35',
  version: 1,
  ruleName: 'Intake outcome is a recognised spelling that is not canonical',
  description:
    "This intake's outcome is written in a spelling the old system used for one of the " +
    'three results this column tracks — approved, rejected or pending, in English or in ' +
    'Dutch, in any case — rather than in the canonical form. The same result, written ' +
    'canonically, is proposed. A value nobody recognises is not touched here, and nothing ' +
    'is guessed.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.outcome;
      if (previous === null) continue; // I37's finding.

      const canonical = CANONICAL_SPELLINGS.get(previous.trim().toLowerCase());
      if (canonical === undefined) continue; // I36's finding, or I37's if blank.
      if (canonical === previous) continue; // Already exactly canonical.

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'outcome',
        prev: previous,
        next: canonical,
      });
    }

    return { ambiguity: false, updates };
  },
};
