import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I19 — an intake's `weight` that reads as a clean, plausible number but
 * cannot be pinned to kilograms or pounds, because unlike `patient`,
 * `intake` carries no unit column at all to check it against.
 *
 * Ambiguous: the same digits mean two different weights depending on the
 * unit, and nothing on the row or the table says which was meant (1.1.12).
 *
 * Boundary: only a cell already clear of I15's comma, I16's unit and I17's
 * unparseable shapes, and inside I18's plausible range, reaches this rule —
 * every clean, plausible weight in this table is this rule's finding.
 *
 * Tests `weight`; reports against `weight` (1.1.5), with no proposal since
 * no unit is recorded anywhere to read.
 */

/** A clean, already-parseable weight: digits, with at most one dot. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

const MIN_PLAUSIBLE = 30;
const MAX_PLAUSIBLE = 400;

export const i19: CatalogueRule = {
  ruleId: 'I19',
  version: 1,
  ruleName: 'Intake weight has no unit column to say what it is measured in',
  description:
    'This intake weight is a clean, plausible number, but this table has no weight_unit ' +
    'column the way the patient table does — nothing anywhere on this row says whether it ' +
    'is kilograms or pounds, and the two readings are not the same weight. Someone who can ' +
    'check the original form needs to say which unit was meant before this number is used ' +
    'for anything.',
  ambiguous: true,

  /**
   * Reads the whole intake table in one call and returns every weight that is
   * clean, plausible, and still unit-ambiguous (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.weight;
      if (previous === null) continue;

      const trimmed = previous.trim();
      if (!PLAIN_NUMBER.test(trimmed)) continue;

      const value = Number.parseFloat(trimmed);
      if (value < MIN_PLAUSIBLE || value > MAX_PLAUSIBLE) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'weight',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
