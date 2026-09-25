import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * C09 v2 — same catch as v1 (a consent's `at` whose date falls after today,
 * with or without a time attached), now rejecting the value instead of
 * waiting on a human to supply one: the rule proposes an empty `at`. No
 * longer ambiguous.
 *
 * Why empty and not null: a null `next` is what an ambiguous rule returns and
 * approval refuses to write it (1.1.12). An empty string is a real proposal —
 * "this timestamp is not a real event date, take it off the row" — and
 * approving it writes it. The original stays in `rawData`.
 *
 * What happens next is C11's, not this rule's (1.1.4): an empty `at` is C11's
 * finding, and C11 asks a human for the real event date. This rule does one
 * thing — take the impossible date off the row.
 *
 * Boundary unchanged from v1: reported only when every reading of the cell's
 * date is future; an unparseable cell is C08's, an empty one C11's.
 *
 * Re-implemented standalone rather than importing v1 (1.1.8): a version is
 * frozen code.
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

export const c09V2: CatalogueRule = {
  ruleId: 'C09',
  version: 2,
  ruleName: 'Consent at is in the future',
  description:
    "This consent's timestamp falls after today, so the row claims an event that has " +
    'not happened yet. A date that has not happened is not a real event date, so the ' +
    'rule rejects it and proposes an empty timestamp. The original stays in the raw ' +
    "row; once cleared, the empty timestamp is C11's to fill in with the real date.",
  ambiguous: false,

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
        next: '',
      });
    }

    return { ambiguity: false, updates };
  },
};
