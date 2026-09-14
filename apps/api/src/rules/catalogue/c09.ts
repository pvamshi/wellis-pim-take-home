import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * C09 — a consent's `at` whose date falls after today, so the row claims an
 * event that has not happened yet — with or without a time attached.
 *
 * Ambiguous: the cell is a real date and nothing on the row says what value
 * was meant instead — a mistyped year, a slipped digit, a stray default
 * (1.1.12).
 *
 * Boundary: reported only when every reading of the cell's date is future,
 * so a two-number cell's unresolved order never decides it; an unparseable
 * or empty cell is neither this rule's nor C08's, and C11's respectively.
 *
 * Tests `at` and reports against it (1.1.5); a real event date in the past
 * keeps an approved row from matching again.
 */

const YEAR_FIRST_DATE = /^(\d{4})([-/.])(\d{2})\2(\d{2})$/;
const DAY_OR_MONTH_FIRST_DATE = /^(\d{1,2})([-/])(\d{1,2})\2(\d{4})$/;

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

/** The date part of the cell, with any time of day dropped — a `T` or space
 * marks where one begins. */
function datePartOf(trimmed: string): string {
  const splitAt = trimmed.search(/[ T]/);
  return splitAt === -1 ? trimmed : trimmed.slice(0, splitAt);
}

/** Every date the cell's date part could be: one reading year first, two —
 * the US order and the day-first order — for a plain two-number date. */
function readingsOf(trimmed: string): CalendarDate[] {
  const datePart = datePartOf(trimmed);

  const yearFirst = YEAR_FIRST_DATE.exec(datePart);
  if (yearFirst !== null) {
    const date = { year: Number(yearFirst[1]), month: Number(yearFirst[3]), day: Number(yearFirst[4]) };
    return isRealDate(date) ? [date] : [];
  }

  const twoNumber = DAY_OR_MONTH_FIRST_DATE.exec(datePart);
  if (twoNumber === null) return [];

  const year = Number(twoNumber[4]);
  const first = Number(twoNumber[1]);
  const second = Number(twoNumber[3]);
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

export const c09: CatalogueRule = {
  ruleId: 'C09',
  version: 1,
  ruleName: 'Consent at is in the future',
  description:
    "This consent's timestamp falls after today, so the row claims an event that has " +
    'not happened yet. Nothing on the row says what date was meant instead — it could ' +
    'be a mistyped year, a slipped digit, or a value nobody entered on purpose — so no ' +
    'value is proposed here. Someone who can check the real event date has to write it in.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const updates = [];
    const today = todayFrom(new Date());

    for (const consent of consents) {
      const previous = consent.at;
      if (previous === null) continue; // C11's finding.

      const readings = readingsOf(previous.trim());
      if (readings.length === 0) continue; // Not a real date in any reading.

      // Some reading is today or earlier — a perfectly good event date.
      if (!readings.every((reading) => isAfter(reading, today))) continue;

      updates.push({
        table: 'consent' as const,
        legacyId: consent.legacyPatientId,
        column: 'at',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
