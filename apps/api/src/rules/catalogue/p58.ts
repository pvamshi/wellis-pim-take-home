import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P58 — a patient's `signup_date` written US-style, `MM/DD/YYYY`, where the
 * day is greater than 12 and so the order of the two numbers is certain.
 *
 * Not ambiguous: a day above 12 cannot be a month, so only one reading
 * parses (1.1.12). The proposal is that same date written ISO.
 *
 * Boundary: the dash spelling of a certain date is P59's, and a date where
 * both numbers are 12 or under is P60's — nobody can tell those apart.
 *
 * Tests `signup_date` and changes `signup_date` (1.1.5); the ISO value
 * carries no slash, so an approved row does not match again.
 */

/** Two numbers on slashes, then a four-digit year. A two-digit year, a
 * dash-separated cell and an already-ISO date are none of this shape. */
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** Days in each month, January first, February's leap day added separately. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export const p58: CatalogueRule = {
  ruleId: 'P58',
  version: 1,
  ruleName: 'Patient signup date is US-style with a certain order',
  description:
    "This patient's signup date is written US-style, month first and separated by " +
    'slashes, and its second number is greater than 12 — so it cannot be a month, the ' +
    'order of the two numbers is certain, and the date has only one reading. The same ' +
    'date written ISO, year-month-day, is proposed. Dates where both numbers are 12 or ' +
    'under are not touched here: those have two readings and no way to choose between ' +
    'them.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.signupDate;
      if (previous === null) continue;

      const matched = SLASH_DATE.exec(previous.trim());
      if (matched === null) continue; // ISO already, dash-spelled (P59), or not a date.

      const month = Number(matched[1]);
      const day = Number(matched[2]);
      const year = Number(matched[3]);

      if (month < 1 || month > 12) continue; // Neither reading is a date.
      if (day <= 12) continue; // P60's finding: both readings parse.
      if (day > daysInMonth(year, month)) continue; // The certain reading doesn't exist.

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'signup_date',
        prev: previous,
        next: `${matched[3]}-${pad(month)}-${pad(day)}`,
      });
    }

    return { ambiguity: false, updates };
  },
};
