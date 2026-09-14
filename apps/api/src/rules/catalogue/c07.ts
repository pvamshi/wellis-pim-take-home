import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * C07 — a consent's `at` written year first, so the order of its date is
 * already certain, but not in the exact ISO shape the column is meant to
 * hold: a different date separator, a space instead of `T`, or no seconds.
 *
 * Not ambiguous: a four-digit year in front pins the reading before the
 * month and day are even looked at, so there is nothing to guess (1.1.12).
 * The proposal is the same instant written `YYYY-MM-DDTHH:MM:SS`.
 *
 * Boundary: a year-first cell with no time at all is C08's finding, and a
 * cell already in that exact shape has nothing to fix.
 *
 * Tests and changes `at` (1.1.5); the ISO value carries none of the
 * separators this rule looks for, so an approved row does not match again.
 */

/** A four-digit year, then month and day on one repeated separator, then a
 * space or `T`, then hours and minutes and optional seconds. */
const YEAR_FIRST_TIMESTAMP = /^(\d{4})([-/.])(\d{2})\2(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

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

export const c07: CatalogueRule = {
  ruleId: 'C07',
  version: 1,
  ruleName: 'Consent at is not ISO but unambiguous',
  description:
    "This consent's timestamp is written year first, so its date has only one reading, " +
    'but not in the exact shape the column is meant to hold — a different date ' +
    'separator, a space where a `T` belongs, or no seconds. The same instant, written ' +
    'ISO, is proposed.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const updates = [];

    for (const consent of consents) {
      const previous = consent.at;
      if (previous === null) continue; // C11's finding.

      const trimmed = previous.trim();
      const matched = YEAR_FIRST_TIMESTAMP.exec(trimmed);
      if (matched === null) continue; // No time at all (C08), or not this shape.

      const year = matched[1] as string;
      const month = Number(matched[3]);
      const day = Number(matched[4]);
      const hour = Number(matched[5]);
      const minute = Number(matched[6]);
      const second = matched[7] === undefined ? 0 : Number(matched[7]);

      if (month < 1 || month > 12) continue; // Not a real date.
      if (day < 1 || day > daysInMonth(Number(year), month)) continue;
      if (hour > 23 || minute > 59 || second > 59) continue; // Not a real time.

      const next = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
      if (next === trimmed) continue; // Already exactly canonical.

      updates.push({
        table: 'consent' as const,
        legacyId: consent.legacyPatientId,
        column: 'at',
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
