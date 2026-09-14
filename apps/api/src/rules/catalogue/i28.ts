import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I28 — an intake's `conditions` holding a way of saying nothing rather
 * than a condition: `none`, `geen`, `n/a`, `-`, `nvt` or `x`, in any case,
 * with or without padding. Proposes the canonical marker `none`.
 *
 * Not ambiguous: each spelling below names the same absence and only that,
 * so reading it is a lookup rather than a guess (1.1.12). Free text that is
 * not one of these spellings is real content and is I29's business, not
 * this one's, whatever padding it carries.
 *
 * Tests `conditions` and changes it (1.1.5); `none` is not itself one of
 * the loose spellings this rule rewrites away from, so an approved row does
 * not match again.
 */

/** Every spelling this rule recognises, lower-cased and trimmed, mapped to
 * the one canonical marker they all stand for. Same closed set I25 reads
 * `meds_current` for — this export uses one small vocabulary for "nothing". */
const EMPTY_MARKERS: ReadonlySet<string> = new Set(['none', 'geen', 'n/a', '-', 'nvt', 'x']);
const CANONICAL_EMPTY = 'none';

export const i28: CatalogueRule = {
  ruleId: 'I28',
  version: 1,
  ruleName: 'Intake conditions is a way of saying nothing',
  description:
    "This intake's conditions cell does not name a condition — it holds a way of saying " +
    'nothing, such as none, geen, n/a, -, nvt or x. The canonical marker "none" is proposed ' +
    'in its place, so every intake with no conditions reads the same way.',
  ambiguous: false,

  /**
   * Reads the whole intake table in one call and returns every conditions
   * cell that says nothing in a recognised way (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.conditions;
      if (previous === null) continue;

      const trimmed = previous.trim();
      if (!EMPTY_MARKERS.has(trimmed.toLowerCase())) continue; // I29's finding, or real content.
      if (previous === CANONICAL_EMPTY) continue; // Already exactly canonical.

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'conditions',
        prev: previous,
        next: CANONICAL_EMPTY,
      });
    }

    return { ambiguity: false, updates };
  },
};
