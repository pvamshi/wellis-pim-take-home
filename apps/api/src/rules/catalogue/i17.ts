import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I17 — an intake's `weight` that is not a number at all: prose, doubled
 * punctuation, or any shape a number reader cannot parse.
 *
 * Ambiguous: there is no single reading to propose, so this rule reports and
 * proposes nothing (1.1.12).
 *
 * Boundary: a comma decimal is I15's finding, a unit typed in is I16's; a
 * clean number that is merely implausible, or unit-ambiguous with no column
 * to check it against, is I18's or I19's, not this one's.
 *
 * Tests `weight`; reports against `weight` (1.1.5), with no proposal since
 * no reading is certain.
 */

/** A clean, already-parseable weight: digits, with at most one dot. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

/** I15's decimal comma, duplicated so this rule can walk past its finds. */
const COMMA_DECIMAL = /\d,\d{1,2}(?!\d)/;

/** I16's closed unit list, duplicated so this rule can walk past its finds. */
const KNOWN_UNITS: ReadonlySet<string> = new Set([
  'kg',
  'kgs',
  'kilo',
  'kilos',
  'kilogram',
  'kilograms',
  'lb',
  'lbs',
  'pound',
  'pounds',
]);
const NUMBER_THEN_UNIT = /^(\d+(?:\.\d+)?)\s*([A-Za-z]+)\.?$/;

/** True when I15 or I16 already has a clean, unambiguous fix for this cell. */
function readByANeighbour(trimmed: string): boolean {
  const isCommaDecimal =
    !trimmed.includes('.') &&
    trimmed.indexOf(',') === trimmed.lastIndexOf(',') &&
    COMMA_DECIMAL.test(trimmed);
  if (isCommaDecimal) return true;

  const matched = NUMBER_THEN_UNIT.exec(trimmed);
  return matched !== null && KNOWN_UNITS.has((matched[2] ?? '').toLowerCase());
}

export const i17: CatalogueRule = {
  ruleId: 'I17',
  version: 1,
  ruleName: 'Intake weight is not a number',
  description:
    'This intake weight does not read as a number at all — not a plain figure, not a comma ' +
    'decimal, not a number with its unit attached, just something a number reader cannot ' +
    'parse. A weight is only ever read as a number, and there is no single reading to ' +
    'propose here, so someone has to say what this cell was meant to hold.',
  ambiguous: true,

  /**
   * Reads the whole intake table in one call and returns every weight that is
   * not a number at all (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.weight;
      if (previous === null) continue;

      const trimmed = previous.trim();
      if (trimmed.length === 0) continue;

      if (PLAIN_NUMBER.test(trimmed)) continue;
      if (readByANeighbour(trimmed)) continue;

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
