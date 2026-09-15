import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, DuplicateFinding, RuleContext, RuleResponse } from '../rule-contract';

/**
 * D05 v2 — same catch as v1 (same intake_id, literal), now naming both
 * physical rows a link is between (1.7.1). Both sides of a link keep the
 * same legacy id — that is the finding, two rows genuinely sharing one
 * intake id — but v1 left the two rows themselves unidentifiable; v2 adds
 * each row's own generated `id`.
 *
 * Re-implemented standalone rather than importing v1 (1.1.8).
 */
export const d05V2: CatalogueRule = {
  ruleId: 'D05',
  version: 2,
  ruleName: 'Two intakes share the same intake id',
  description:
    'Two intake rows carry the same intake id — a sign the same submission was recorded ' +
    'more than once. The earlier row, in the order this export lists them, is treated as ' +
    'the one the other duplicates.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const canonicalRowIdByLegacyId = new Map<string, string>();
    const duplicates: DuplicateFinding[] = [];

    for (const intake of intakes) {
      const previous = intake.legacyIntakeId;
      if (previous.trim().length === 0) continue; // Nothing to address the row by.

      const canonicalRowId = canonicalRowIdByLegacyId.get(previous);

      if (canonicalRowId === undefined) {
        canonicalRowIdByLegacyId.set(previous, intake.id);
        continue;
      }

      // Both sides of the link are this same id — the id itself is what
      // repeats, so there is no separate canonical id to point at instead.
      duplicates.push({
        table: 'intake' as const,
        duplicateLegacyId: previous,
        duplicateRowId: intake.id,
        canonicalLegacyId: previous,
        canonicalRowId,
      });
    }

    return { ambiguity: false, updates: [], duplicates };
  },
};
