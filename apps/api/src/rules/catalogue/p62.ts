import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P62 — a patient's `signup_date` that falls before their own `dob`, so the
 * row claims a signup before the patient was born.
 *
 * Ambiguous: either cell could be the wrong one and nothing on the row says
 * which — rewriting either is a guess at a birth date or a signup date
 * (1.1.12).
 *
 * Boundary: reported only when every reading of `signup_date` precedes every
 * reading of `dob`, so an unresolved two-way date never decides the finding;
 * a cell with no real-date reading is skipped, same as P61.
 *
 * Tests `signup_date` and `dob` (1.1.6), reports against `signup_date`
 * (1.1.5); a fix to either column that removes the conflict stops the row.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** `signup_date`'s two spellings, P58 and P59's: slash or dash. */
const SIGNUP_DAY_MONTH_YEAR = /^(\d{1,2})([-/])(\d{1,2})\2(\d{4})$/;
/** `dob`'s three spellings, P16 and P17's: slash, dash or dot. */
const DOB_DAY_MONTH_YEAR = /^(\d{1,2})([-./])(\d{1,2})\2(\d{4})$/;

/** Days in each month, January first, February's leap day added separately. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

function isRealDate(date: CalendarDate): boolean {
  if (date.month < 1 || date.month > 12) return false;
  return date.day >= 1 && date.day <= daysInMonth(date.year, date.month);
}

/** Every date a cell could be, read against `dayMonthYear`'s separators. An
 * ISO cell has one reading; a two-number cell has two, US and day-first. */
function readingsOf(cell: string, dayMonthYear: RegExp): CalendarDate[] {
  const iso = ISO_DATE.exec(cell);
  if (iso !== null) {
    const date = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
    return isRealDate(date) ? [date] : [];
  }

  const numbers = dayMonthYear.exec(cell);
  if (numbers === null) return [];

  const year = Number(numbers[4]);
  const first = Number(numbers[1]);
  const second = Number(numbers[3]);

  return [
    { year, month: first, day: second },
    { year, month: second, day: first },
  ].filter(isRealDate);
}

function isBefore(date: CalendarDate, other: CalendarDate): boolean {
  if (date.year !== other.year) return date.year < other.year;
  if (date.month !== other.month) return date.month < other.month;
  return date.day < other.day;
}

export const p62: CatalogueRule = {
  ruleId: 'P62',
  version: 1,
  ruleName: "Patient signup date is earlier than the patient's date of birth",
  description:
    "This patient's signup date falls before their own date of birth, so the row claims " +
    'a signup before the patient was born. Either date could be the one that is wrong, ' +
    'and nothing on the row says which, so no value is proposed here. Someone who can ' +
    "check the patient's real signup date and date of birth has to write in whichever " +
    'one was mistaken, year-month-day.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previousSignup = patient.signupDate;
      const previousDob = patient.dob;
      if (previousSignup === null || previousDob === null) continue;

      const signupReadings = readingsOf(previousSignup.trim(), SIGNUP_DAY_MONTH_YEAR);
      const dobReadings = readingsOf(previousDob.trim(), DOB_DAY_MONTH_YEAR);
      if (signupReadings.length === 0 || dobReadings.length === 0) continue;

      // True only when every possible reading of one cell precedes every
      // possible reading of the other, so an unresolved two-way date on
      // either column never decides this rule's finding by accident.
      const allEarlier = signupReadings.every((signup) =>
        dobReadings.every((dob) => isBefore(signup, dob)),
      );
      if (!allEarlier) continue;

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'signup_date',
        prev: previousSignup,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
