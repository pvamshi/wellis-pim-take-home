import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I13 — an intake's `questionnaire_version` holding a label that names none
 * of the versions this export actually has (`v1`, `v2`, `v3`): not a spelling
 * I12 recognises, and not empty.
 *
 * Ambiguous: `v4`, `beta`, `draft`, `2024-intake` and the like each plainly
 * mean something to whoever wrote it, but which real version they intended is
 * a business call, not a lookup — a wrong-shaped label is not a translation,
 * and guessing writes a version onto an intake nobody confirmed (1.1.12).
 *
 * Tests `questionnaire_version` and reports against it (1.1.5); a label I12
 * recognises or an empty cell (I14's) is walked past, so a row a human
 * resolves by writing a known version in does not match again.
 */

/** The same loose shape I12 reads: optional `version`, optional `v`, digits,
 * optional trailing `.0`, applied trimmed and lower-cased. */
const LOOSE_VERSION = /^(?:version\s*)?v?(\d+)(?:\.0)?$/;

/** The versions this export actually has. A loose label that folds to one of
 * these is recognised and is I12's finding, not this rule's. */
const KNOWN_VERSIONS = new Set(['v1', 'v2', 'v3']);

export const i13: CatalogueRule = {
  ruleId: 'I13',
  version: 1,
  ruleName: 'Intake questionnaire version matches no known version',
  description:
    "This intake's questionnaire version is a value the register cannot read as v1, v2 " +
    'or v3. The old system took this column as free text, and this cell holds something ' +
    'that reads as an answer but names no version this export actually has. Nothing is ' +
    'proposed, because turning it into one of the known versions would be a guess about ' +
    'which form the patient actually filled in. A human decides which version it means, ' +
    'or writes it in some other form the register can hold.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.questionnaireVersion;
      if (previous === null) continue; // I14's finding.

      const trimmed = previous.trim();
      if (trimmed.length === 0) continue; // I14's finding.

      const matched = LOOSE_VERSION.exec(trimmed.toLowerCase());
      if (matched !== null) {
        const canonical = `v${Number(matched[1])}`;
        if (KNOWN_VERSIONS.has(canonical)) continue; // I12's finding, or already canonical.
      }

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'questionnaire_version',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
