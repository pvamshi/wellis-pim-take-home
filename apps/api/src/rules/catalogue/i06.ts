import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I06 — an intake's `submitted_at` written US-style, `MM/DD/YYYY`, where the
 * day is greater than 12 and so the order of the two numbers is certain.
 *
 * Not ambiguous: a day above 12 cannot be a month, so only one reading
 * parses (1.1.12). The proposal is that same date written ISO.
 *
 * Boundary: the dash spelling of a certain date is I07's, and a date where
 * both numbers are 12 or under has two readings this rule cannot choose
 * between and is left untouched.
 *
 * Tests `submitted_at` and changes `submitted_at` (1.1.5); the ISO value
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

export const i06: CatalogueRule = {
  ruleId: 'I06',
  version: 1,
  ruleName: 'Intake submitted date is US-style with a certain order',
  description:
    "This intake's submitted date is written US-style, month first and separated by " +
    'slashes, and its second number is greater than 12 — so it cannot be a month, the ' +
    'order of the two numbers is certain, and the date has only one reading. The same ' +
    'date written ISO, year-month-day, is proposed. Dates where both numbers are 12 or ' +
    'under are not touched here: those have two readings and no way to choose between ' +
    'them.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.submittedAt;
      if (previous === null) continue;

      const matched = SLASH_DATE.exec(previous.trim());
      if (matched === null) continue; // ISO already, dash-spelled (I07), or not a date.

      const month = Number(matched[1]);
      const day = Number(matched[2]);
      const year = Number(matched[3]);

      if (month < 1 || month > 12) continue; // Neither reading is a date.
      if (day <= 12) continue; // Both readings parse — left for a human.
      if (day > daysInMonth(year, month)) continue; // The certain reading doesn't exist.

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'submitted_at',
        prev: previous,
        next: `${matched[3]}-${pad(month)}-${pad(day)}`,
      });
    }

    return { ambiguity: false, updates };
  },
};
