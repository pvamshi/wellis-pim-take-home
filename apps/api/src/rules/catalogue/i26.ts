import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I26 — an intake's `meds_current` holding real free text naming medication:
 * whatever is left once padding (I24) and the empty markers (I25) are read
 * past. It has never been run through any normalisation.
 *
 * Ambiguous: turning free-form drug names into a canonical form is a lookup
 * against real-world medication knowledge, not a mechanical rewrite this
 * rule can perform, so nothing is proposed (1.1.12).
 *
 * Boundary: padded text is I24's finding and a recognised empty marker is
 * I25's; what remains — the medication text itself — is this rule's, and
 * every such cell in the column is one, so there is no narrower case to draw.
 *
 * Tests `meds_current`; reports against `meds_current` (1.1.5), with no
 * proposal since no normalised form is certain.
 */

/** I25's closed set of "nothing" markers, duplicated so this rule can walk past its finds. */
const EMPTY_MARKERS: ReadonlySet<string> = new Set(['none', 'geen', 'n/a', '-', 'nvt', 'x']);

export const i26: CatalogueRule = {
  ruleId: 'I26',
  version: 1,
  ruleName: 'Intake current medication is free text that has never been normalised',
  description:
    "This intake's current-medication cell names real medication as free text, the way " +
    'every such cell in this export was written, and it has never been run through any ' +
    'normalisation. Turning drug names written by hand into a canonical form is not a ' +
    'mechanical fix — it needs someone who can read the names and match them against a ' +
    'real medication list, so nothing is proposed here.',
  ambiguous: true,

  /**
   * Reads the whole intake table in one call and returns every current-
   * medication cell holding un-normalised free text (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.medsCurrent;
      if (previous === null) continue;

      const trimmed = previous.trim();
      if (trimmed.length === 0) continue; // Nothing named at all.
      if (trimmed !== previous) continue; // Padded — I24's finding.
      if (EMPTY_MARKERS.has(trimmed.toLowerCase())) continue; // I25's finding.

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'meds_current',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
