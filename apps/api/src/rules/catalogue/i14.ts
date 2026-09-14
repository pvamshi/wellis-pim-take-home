import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I14 — an intake's `questionnaire_version` that is empty: missing outright,
 * or holding nothing but whitespace.
 *
 * Ambiguous: nothing else on the row says which form the patient actually
 * filled in, so this rule reports and proposes nothing (1.1.12).
 *
 * Boundary: I12 reads a loose but recognisable version, I13 reads a label
 * naming none that exists — both walk past a blank cell, and this rule is
 * the one that catches it.
 *
 * Tests `questionnaire_version`; reports against it (1.1.5) — a human
 * writing a real version in is what keeps an approved row from matching
 * again.
 */

function isEmpty(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const i14: CatalogueRule = {
  ruleId: 'I14',
  version: 1,
  ruleName: 'Intake questionnaire version is empty',
  description:
    "This intake row has no questionnaire version — the column is empty, missing, or holds " +
    'nothing but whitespace. Nothing else on the row says which form the patient actually ' +
    'filled in, so no version is proposed here. Someone who can check the original ' +
    'submission has to write in v1, v2 or v3, or record that it is not known.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.questionnaireVersion;
      if (!isEmpty(previous)) continue;

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
