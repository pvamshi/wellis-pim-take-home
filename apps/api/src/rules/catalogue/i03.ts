import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I03 — an intake's `legacy_patient_id` with whitespace around it. Proposes
 * the trimmed id.
 *
 * Not ambiguous: padding is the spreadsheet's, not part of the id it points
 * at, so trimming reads the cell rather than guessing at it. Trimmed away to
 * nothing is I05's finding, not this one's — this rule proposes an id, and an
 * empty string is not one.
 *
 * Tests `legacy_patient_id` and changes `legacy_patient_id` (1.1.5), and the
 * trimmed value has no padding left, so an approved row does not match again.
 */
export const i03: CatalogueRule = {
  ruleId: 'I03',
  version: 1,
  ruleName: 'Intake patient reference has whitespace around it',
  description:
    "This intake's patient id has spaces around it. The trimmed id is proposed: the " +
    'same id, with the padding the old export left on it removed, so it matches the id ' +
    'the patient row itself is keyed by.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.legacyPatientId;
      if (previous === null) continue;

      const next = previous.trim();

      // Nothing left to reference. I05's finding, not invented here.
      if (next.length === 0) continue;

      // No padding to remove.
      if (next === previous) continue;

      updates.push({
        table: 'intake' as const,
        // This row's own id, not the reference under test (1.1.5's address is
        // the row, not the column).
        legacyId: intake.legacyIntakeId,
        column: 'legacy_patient_id',
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
