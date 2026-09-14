import { LegacyConsent } from '../../legacy/legacy-consent.entity';
import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * C10 — a consent's `at` whose date falls before the `signup_date` of the
 * patient it names, so the row claims an event before that patient signed up
 * (1.1.6: the fact spans `legacy_consent` and `legacy_patient`).
 *
 * Ambiguous: either date could be the wrong one and nothing on the row says
 * which — rewriting either is a guess at an event date or a signup date
 * (1.1.12).
 *
 * Boundary: reported only when every reading of both dates agrees, so an
 * unresolved two-number order never decides it; a patient reference this
 * rule cannot resolve outright is C01's, C02's or C03's, not guessed at here.
 *
 * Tests `at` and `signup_date`, reports against `at` (1.1.5); a fix to
 * either column that removes the conflict stops the row.
 */

const YEAR_FIRST_DATE = /^(\d{4})([-/.])(\d{2})\2(\d{2})$/;
/** Both columns' two-number spellings, slash or dash. */
const TWO_NUMBER_DATE = /^(\d{1,2})([-/])(\d{1,2})\2(\d{4})$/;

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

/** The date part of the cell, with any time of day dropped. */
function datePartOf(trimmed: string): string {
  const splitAt = trimmed.search(/[ T]/);
  return splitAt === -1 ? trimmed : trimmed.slice(0, splitAt);
}

/** Every date a cell's date part could be: one reading year first, two — US
 * and day-first — for a plain two-number date. Used for both `at` and
 * `signup_date`; the latter carries no time to split off. */
function readingsOf(trimmed: string): CalendarDate[] {
  const datePart = datePartOf(trimmed);

  const yearFirst = YEAR_FIRST_DATE.exec(datePart);
  if (yearFirst !== null) {
    const date = { year: Number(yearFirst[1]), month: Number(yearFirst[3]), day: Number(yearFirst[4]) };
    return isRealDate(date) ? [date] : [];
  }

  const twoNumber = TWO_NUMBER_DATE.exec(datePart);
  if (twoNumber === null) return [];

  const year = Number(twoNumber[4]);
  const first = Number(twoNumber[1]);
  const second = Number(twoNumber[3]);
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

export const c10: CatalogueRule = {
  ruleId: 'C10',
  version: 1,
  ruleName: "Consent at is earlier than the patient's signup date",
  description:
    "This consent's timestamp falls before the signup date of the patient it names, so " +
    'the row claims an event before that patient signed up. Either date could be the ' +
    'one that is wrong, and nothing on the row says which, so no value is proposed here. ' +
    'Someone who can check the real event date and signup date has to write in whichever ' +
    'one was mistaken.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const consents = await context.find(LegacyConsent);
    const patients = await context.find(LegacyPatient);
    const updates = [];

    // Legacy ids are not unique (1.0.3): every patient sharing an id is kept,
    // so the finding only fires when it holds against all of them.
    const patientsById = new Map<string, LegacyPatient[]>();
    for (const patient of patients) {
      const list = patientsById.get(patient.legacyPatientId) ?? [];
      list.push(patient);
      patientsById.set(patient.legacyPatientId, list);
    }

    for (const consent of consents) {
      const previous = consent.at;
      const patientId = consent.legacyPatientId;
      if (previous === null) continue; // C11's finding.
      if (patientId.trim().length === 0) continue; // C03's finding.
      if (patientId !== patientId.trim()) continue; // C01's finding, not looked up here.

      const atReadings = readingsOf(previous.trim());
      if (atReadings.length === 0) continue; // Not a real date in any reading.

      const matches = patientsById.get(patientId) ?? [];
      if (matches.length === 0) continue; // C02's finding: no patient to compare against.

      const signupReadings = matches.flatMap((patient) =>
        patient.signupDate === null ? [] : readingsOf(patient.signupDate.trim()),
      );
      if (signupReadings.length === 0) continue;

      // True only when every possible reading of the event precedes every
      // possible reading of every matching patient's signup date.
      const allEarlier = atReadings.every((at) => signupReadings.every((signup) => isBefore(at, signup)));
      if (!allEarlier) continue;

      updates.push({
        table: 'consent' as const,
        legacyId: patientId,
        column: 'at',
        prev: previous,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
