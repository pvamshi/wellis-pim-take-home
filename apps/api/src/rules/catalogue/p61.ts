import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P61 — a patient's `signup_date` that falls after today, so the row claims a
 * signup that has not happened yet.
 *
 * Ambiguous: the cell is a real date and nothing on the row says what value
 * was meant instead — a mistyped year, a slipped digit, a stray default
 * (1.1.12).
 *
 * Boundary: reported only when every reading of the cell is future, so P60's
 * unresolved order never decides the finding; an unparseable or empty cell is
 * neither this rule's nor P60's, and P63's respectively.
 *
 * Tests `signup_date` and reports against it (1.1.5); a real signup date in
 * the past keeps an approved row from matching again.
 */

/** A full ISO date, or two numbers on a slash or a dash and a four-digit
 * year — the shapes P58, P59 and P60 already read on this column. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MONTH_YEAR = /^(\d{1,2})([-/])(\d{1,2})\2(\d{4})$/;

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

/**
 * Every date this cell could be. An ISO cell has one reading; a two-number
 * cell has two — the US order and the day-first order — and both are kept,
 * so "future" is only reported when neither reading leaves room for doubt.
 */
function readingsOf(cell: string): CalendarDate[] {
  const iso = ISO_DATE.exec(cell);
  if (iso !== null) {
    const date = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
    return isRealDate(date) ? [date] : [];
  }

  const numbers = DAY_MONTH_YEAR.exec(cell);
  if (numbers === null) return [];

  const year = Number(numbers[4]);
  const first = Number(numbers[1]);
  const second = Number(numbers[3]);

  return [
    { year, month: first, day: second },
    { year, month: second, day: first },
  ].filter(isRealDate);
}

function isAfter(date: CalendarDate, other: CalendarDate): boolean {
  if (date.year !== other.year) return date.year > other.year;
  if (date.month !== other.month) return date.month > other.month;
  return date.day > other.day;
}

function todayFrom(clock: Date): CalendarDate {
  return { year: clock.getFullYear(), month: clock.getMonth() + 1, day: clock.getDate() };
}

export const p61: CatalogueRule = {
  ruleId: 'P61',
  version: 1,
  ruleName: 'Patient signup date is in the future',
  description:
    "This patient's signup date falls after today, so the row claims a signup that has " +
    'not happened yet. Nothing on the row says what date was meant instead — it could be ' +
    'a mistyped year, a slipped digit, or a value nobody entered on purpose — so no date ' +
    'is proposed here. Someone who can check the real signup date has to write it in, ' +
    'year-month-day.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];
    const today = todayFrom(new Date());

    for (const patient of patients) {
      const previous = patient.signupDate;
      if (previous === null) continue; // Nothing to read. P63's finding.

      const readings = readingsOf(previous.trim());
      if (readings.length === 0) continue; // Not a real date in any reading.

      // Some reading is today or earlier — a perfectly good signup date.
      if (!readings.every((reading) => isAfter(reading, today))) continue;

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
