import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I12 — an intake's `questionnaire_version` naming a real version of the
 * questionnaire — `v1`, `v2` or `v3` — in a loose spelling: any case, the
 * bare number, the word `version`, or a trailing `.0`.
 *
 * Not ambiguous: each loose spelling names one version and only one, so
 * reading it is a lookup rather than a guess (1.1.12). A label naming no
 * real version is I13's refusal, not this rule's business; an empty cell is
 * I14's.
 *
 * Tests `questionnaire_version` and changes it (1.1.5); the canonical label
 * carries none of the loose spellings, so an approved row does not match
 * again.
 */

/** Optional `version` word, optional `v`, the digits, optional trailing
 * `.0` — the four loose shapes this rule reads: `V2`, `2`, `version 2`,
 * `v2.0`. Applied to the cell already trimmed and lower-cased. */
const LOOSE_VERSION = /^(?:version\s*)?v?(\d+)(?:\.0)?$/;

/** The versions this export actually has. A number outside this set is a
 * label shaped like a version that names none that exist — I13's finding. */
const KNOWN_VERSIONS = new Set(['v1', 'v2', 'v3']);

export const i12: CatalogueRule = {
  ruleId: 'I12',
  version: 1,
  ruleName: 'Intake questionnaire version is a recognised form written loosely',
  description:
    "This intake's questionnaire version names a real version of the form — v1, v2 or " +
    'v3 — but not in the canonical spelling: a different case, a bare number, the word ' +
    '"version", or a trailing .0. The same version, written canonically, is proposed. A ' +
    'label naming no real version is not touched here, and nothing is guessed.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.questionnaireVersion;
      if (previous === null) continue; // I14's finding.

      const trimmed = previous.trim();
      if (trimmed.length === 0) continue; // I14's finding.

      const matched = LOOSE_VERSION.exec(trimmed.toLowerCase());
      if (matched === null) continue; // I13's finding, or not version-shaped at all.

      const canonical = `v${Number(matched[1])}`;
      if (!KNOWN_VERSIONS.has(canonical)) continue; // I13's finding: no such version.
      if (canonical === previous) continue; // Already exactly canonical.

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'questionnaire_version',
        prev: previous,
        next: canonical,
      });
    }

    return { ambiguity: false, updates };
  },
};
