import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I07 — an intake's `submitted_at` written `DD-MM-YYYY`, where the first
 * number is greater than 12 and so the order of the two numbers is certain:
 * unambiguous, but not the ISO shape the column is meant to hold.
 *
 * Not ambiguous: a number above 12 cannot be a month, so only one reading
 * parses (1.1.12). The proposal is that same date written ISO.
 *
 * Boundary: the slash-spelled, US-order certain date is I06's, and a date
 * where both numbers are 12 or under has two readings this rule cannot
 * choose between and is left untouched.
 *
 * Tests `submitted_at` and changes `submitted_at` (1.1.5); the ISO value
 * leads with a four-digit year, so an approved row does not match again.
 */

/** Two numbers on dashes, then a four-digit year. A two-digit year, a
 * slash-separated cell and an already-ISO date are none of this shape. */
const DASH_DATE = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;

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

export const i07: CatalogueRule = {
  ruleId: 'I07',
  version: 1,
  ruleName: 'Intake submitted date is unambiguous but not ISO',
  description:
    "This intake's submitted date is written day first and separated by dashes, and its " +
    'first number is greater than 12 — so it cannot be a month, the order of the two ' +
    'numbers is certain, and the date has only one reading. The same date written ISO, ' +
    'year-month-day, is proposed. Dates where both numbers are 12 or under are not ' +
    'touched here: those have two readings and no way to choose between them.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
    const updates = [];

    for (const intake of intakes) {
      const previous = intake.submittedAt;
      if (previous === null) continue;

      const matched = DASH_DATE.exec(previous.trim());
      if (matched === null) continue; // ISO already, slash-spelled (I06), or not a date.

      const day = Number(matched[1]);
      const month = Number(matched[2]);
      const year = Number(matched[3]);

      if (day <= 12) continue; // Both readings parse — left for a human.
      if (month < 1 || month > 12) continue; // Neither reading is a date.
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
