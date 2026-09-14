import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, DuplicateFinding, RuleContext, RuleResponse } from '../rule-contract';

/**
 * D05 — two intake rows whose `intake_id` matches exactly: literal equality,
 * no fold, since the catalogue asks for "the same intake_id" and nothing else.
 *
 * Not field-shaped and not ambiguous (1.1.13): a link changes no column of
 * either row, so nothing is proposed and no human is asked — the first row
 * holding a given id, in table order, is the one the rest duplicate.
 *
 * `legacy_intake.intake_id` is indexed, not unique (1.0.3) — this rule is the
 * case that note anticipates, so the id it links a row by is the same id on
 * both sides, unlike a patient-dedup rule linking two different ids. A blank
 * cell matches nothing here — left to whatever rule reads a missing id.
 *
 * Reads `intake_id`; an approved link stays untouched on a rerun.
 */
export const d05: CatalogueRule = {
  ruleId: 'D05',
  version: 1,
  ruleName: 'Two intakes share the same intake id',
  description:
    'Two intake rows carry the same intake id — a sign the same submission was recorded ' +
    'more than once. The earlier row, in the order this export lists them, is treated as ' +
    'the one the other duplicates.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const seen = new Set<string>();
    const duplicates: DuplicateFinding[] = [];

    for (const intake of intakes) {
      const previous = intake.legacyIntakeId;
      if (previous.trim().length === 0) continue; // Nothing to address the row by.

      if (!seen.has(previous)) {
        seen.add(previous);
        continue;
      }

      // Both sides of the link are this same id — the id itself is what
      // repeats, so there is no separate canonical id to point at instead.
      duplicates.push({
        table: 'intake' as const,
        duplicateLegacyId: previous,
        canonicalLegacyId: previous,
      });
    }

    return { ambiguity: false, updates: [], duplicates };
  },
};
