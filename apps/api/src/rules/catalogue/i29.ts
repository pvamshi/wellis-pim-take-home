import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I29 — an intake's `conditions` holding real free text naming a condition,
 * in a mix of Dutch and English: whatever is left once padding (I27) and
 * the empty markers (I28) are read past.
 *
 * Ambiguous: reading which language a cell is in, and what it names in
 * medical terms, is a human judgement call, not a rewrite this rule can
 * make on its own — a wrong guess miswrites a patient's condition (1.1.12).
 *
 * Boundary: padded text is I27's finding and a recognised empty marker is
 * I28's; what remains — the condition text itself — is this rule's, and
 * every such cell in the column is one, so there is no narrower case to draw.
 *
 * Tests `conditions`; reports against `conditions` (1.1.5), with no
 * proposal since no reading is certain.
 */

/** I28's closed set of "nothing" markers, duplicated so this rule can walk past its finds. */
const EMPTY_MARKERS: ReadonlySet<string> = new Set(['none', 'geen', 'n/a', '-', 'nvt', 'x']);

export const i29: CatalogueRule = {
  ruleId: 'I29',
  version: 1,
  ruleName: 'Intake conditions is free text mixing Dutch and English',
  description:
    "This intake's conditions cell names a real condition as free text, written in a mix " +
    'of Dutch and English rather than one settled language or vocabulary. Reading which ' +
    'language a word is in, and what it names, is a human judgement call that this rule ' +
    'cannot make safely on its own, so nothing is proposed here.',
  ambiguous: true,

  /**
   * Reads the whole intake table in one call and returns every conditions
   * cell holding un-normalised free text (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.conditions;
      if (previous === null) continue;

      const trimmed = previous.trim();
      if (trimmed.length === 0) continue; // Nothing named at all.
      if (trimmed !== previous) continue; // Padded — I27's finding.
      if (EMPTY_MARKERS.has(trimmed.toLowerCase())) continue; // I28's finding.

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'conditions',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
