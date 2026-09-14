import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P60 — a patient's `signup_date` whose two leading numbers are both 12 or
 * under, slash- or dash-separated, so the US reading and the day-first
 * reading are both dates and the cell does not say which was meant.
 *
 * Ambiguous: `03/04/2023` is the 4th of March or the 3rd of April, both real,
 * and nothing on the row settles it — `source` names the funnel, not a date
 * format, and every automation's habit is unrecorded (1.1.12).
 *
 * Boundary: one number above 12 makes the order certain and is P58's fix on
 * the slash spelling, P59's on the dash — this rule is what is left.
 *
 * Tests `signup_date` and reports against `signup_date` (1.1.5); an ISO date
 * a human confirms does not match again.
 */

/** Two numbers on one separator — a slash or a dash — then a four-digit
 * year. The second separator backreferences the first, so it has to match. */
const TWO_NUMBER_DATE = /^(\d{1,2})([-/])(\d{1,2})\2(\d{4})$/;

/** True when the number could be a month: 1 to 12. Both passing is the whole
 * of the finding — each can be the month, so each can be the day. */
function couldBeMonth(value: number): boolean {
  return value >= 1 && value <= 12;
}

export const p60: CatalogueRule = {
  ruleId: 'P60',
  version: 1,
  ruleName: 'Patient signup date reads as a date both ways round',
  description:
    "This patient's signup date has two numbers that are both 12 or under, so it is a " +
    'real date read either way round: 03/04/2023 is the 4th of March read US-style and ' +
    'the 3rd of April read day-first. Nothing on the row settles which the automation ' +
    'that wrote it meant, so no date is proposed here. Someone who can check the real ' +
    'signup date has to write it in, year-month-day.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.signupDate;
      if (previous === null) continue;

      const matched = TWO_NUMBER_DATE.exec(previous.trim());
      if (matched === null) continue; // ISO already, or not this shape.

      const first = Number(matched[1]);
      const second = Number(matched[3]);
      if (!couldBeMonth(first) || !couldBeMonth(second)) continue; // P58's or P59's finding.

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'signup_date',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
