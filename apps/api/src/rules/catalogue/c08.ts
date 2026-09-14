import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * C08 — a consent's `at` that reads as a calendar date and nothing more: no
 * time of day is attached at all, in any of the date shapes this catalogue
 * already recognises — year first, or two numbers and a year.
 *
 * Ambiguous: a consent event happened at some moment, and a bare date says
 * which day but not which hour — nobody can fill that in from the row
 * (1.1.12).
 *
 * Boundary: a cell carrying a time is C07's shape to fix, C09's or C10's to
 * judge, or already canonical; C11 is the empty cell this rule never sees.
 *
 * Tests `at` and reports against it (1.1.5); a human writing the real
 * instant in, with a time attached, is what keeps an approved row from
 * matching again.
 */

const YEAR_FIRST_DATE = /^(\d{4})([-/.])(\d{2})\2(\d{2})$/;
const DAY_OR_MONTH_FIRST_DATE = /^(\d{1,2})([-/])(\d{1,2})\2(\d{4})$/;

/** Days in each month, January first, February's leap day added separately. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/** True when the whole trimmed cell is a date and nothing else — no reading
 * needs to be picked, since either way there is no time attached. */
function isDateOnly(trimmed: string): boolean {
  const yearFirst = YEAR_FIRST_DATE.exec(trimmed);
  if (yearFirst !== null) {
    return isRealDate(Number(yearFirst[1]), Number(yearFirst[3]), Number(yearFirst[4]));
  }

  const twoNumber = DAY_OR_MONTH_FIRST_DATE.exec(trimmed);
  if (twoNumber === null) return false;

  const year = Number(twoNumber[4]);
  const first = Number(twoNumber[1]);
  const second = Number(twoNumber[3]);
  return isRealDate(year, first, second) || isRealDate(year, second, first);
}

export const c08: CatalogueRule = {
  ruleId: 'C08',
  version: 1,
  ruleName: 'Consent at is a date with no time at all',
  description:
    "This consent's timestamp is only a calendar date — no time of day is attached, so " +
    'the row says which day the event happened but not which hour. Nothing else on the ' +
    'row says what time was meant, so no value is proposed here. Someone who can check ' +
    'the real event has to write the full timestamp in.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const updates = [];

    for (const consent of consents) {
      const previous = consent.at;
      if (previous === null) continue; // C11's finding.

      const trimmed = previous.trim();
      if (trimmed.length === 0) continue; // C11's finding.
      if (!isDateOnly(trimmed)) continue;

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
