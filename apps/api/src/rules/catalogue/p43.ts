import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P43 — a patient's `weight` that is not a number at all: prose, doubled
 * punctuation, or any shape a number reader cannot parse.
 *
 * Ambiguous: there is no single reading to propose, so this rule reports and
 * proposes nothing (1.1.12).
 *
 * Boundary against `weight`'s other rules: a comma decimal is P41's, a value
 * with its unit typed in is P42's, an empty cell is P45's — this rule is what
 * is left once those three, and a clean parseable number, are ruled out. A
 * clean number that is merely implausible is P44's, not this one's.
 */

/** A clean, already-parseable weight: digits, with at most one dot. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

/** P41's decimal comma, duplicated so this rule can walk past its finds. */
const COMMA_DECIMAL = /\d,\d{1,2}(?!\d)/;

/** P42's closed unit list, duplicated so this rule can walk past its finds. */
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

/** True when P41 or P42 already has a clean, unambiguous fix for this cell. */
function readByANeighbour(trimmed: string): boolean {
  const isCommaDecimal =
    !trimmed.includes('.') &&
    trimmed.indexOf(',') === trimmed.lastIndexOf(',') &&
    COMMA_DECIMAL.test(trimmed);
  if (isCommaDecimal) return true;

  const matched = NUMBER_THEN_UNIT.exec(trimmed);
  return matched !== null && KNOWN_UNITS.has((matched[2] ?? '').toLowerCase());
}

export const p43: CatalogueRule = {
  ruleId: 'P43',
  version: 1,
  ruleName: 'Patient weight is not a number',
  description:
    'This weight does not read as a number at all — not a plain figure, not a comma decimal, ' +
    'not a number with its unit attached, just something a number reader cannot parse. A ' +
    'weight is only ever read as a number, and there is no single reading to propose here, so ' +
    'someone has to say what this cell was meant to hold.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every weight that is
   * not a number at all (1.1.14). Tests `weight`; reports against `weight`
   * (1.1.5), with no proposal since no reading is certain.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.weight;
      if (previous === null) continue;

      const trimmed = previous.trim();

      // Nothing to read at all. P45's finding.
      if (trimmed.length === 0) continue;

      // Already clean, or already readable by a rule with a fix of its own.
      if (PLAIN_NUMBER.test(trimmed)) continue;
      if (readByANeighbour(trimmed)) continue;

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'weight',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
