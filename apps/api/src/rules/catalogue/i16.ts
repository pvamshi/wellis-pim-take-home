import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I16 — an intake's `weight` with the unit typed into the value: `82 kg`,
 * `180lbs`. The proposal is the number alone.
 *
 * Not ambiguous: the number is already in the cell as reported, and removing
 * a unit takes nothing away from it — only a closed list of kg and lbs
 * spellings is stripped, so nothing is guessed (1.1.12).
 *
 * Boundary: a comma decimal is I15's finding; a unit spelling outside the
 * list, or anything else in the cell besides a number and a unit, is I17's.
 *
 * Tests and changes `weight` (1.1.5); the proposal is digits alone, so an
 * approved row does not match again.
 */

/** Every unit spelling this rule strips — the two units this export is in. */
const UNITS: ReadonlySet<string> = new Set([
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

/** A number then one word, and nothing else besides surrounding whitespace. */
const NUMBER_THEN_UNIT = /^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)\.?\s*$/;

/** The number a cell holds when the rest of it is one recognised unit word. */
function numberWithoutUnit(value: string): string | null {
  const matched = NUMBER_THEN_UNIT.exec(value);
  if (matched === null) return null;

  const written = matched[1] ?? '';
  const unit = matched[2] ?? '';
  if (!UNITS.has(unit.toLowerCase())) return null;

  return written;
}

export const i16: CatalogueRule = {
  ruleId: 'I16',
  version: 1,
  ruleName: 'Intake weight has its unit written into the value',
  description:
    'This intake weight has the unit typed into the value — 82 kg, 180lbs — with nowhere ' +
    'else on this row for a unit to be recorded. A weight is only ever read as a number, and ' +
    'a strict reader takes nothing from this cell while a forgiving one reads the leading ' +
    'digits and drops the unit on the floor. The number is proposed exactly as it was ' +
    'reported, with the unit and the spacing around it removed and no digit touched. Only a ' +
    'closed list of spellings of kilograms and pounds is removed, so a cell ending in ' +
    'anything else is left whole for a human.',
  ambiguous: false,

  /**
   * Reads the whole intake table in one call and returns every weight whose
   * value carries its unit (1.1.14).
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.weight;
      if (previous === null) continue;

      const next = numberWithoutUnit(previous);
      if (next === null) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'weight',
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
