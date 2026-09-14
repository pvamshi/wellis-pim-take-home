import { LegacyIntake } from '../../legacy/legacy-intake.entity';
import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * I10 — an intake's `submitted_at` that falls before the `signup_date` of the
 * patient it names, so the row claims a submission before that patient
 * signed up (1.1.6: the fact spans `legacy_intake` and `legacy_patient`).
 *
 * Ambiguous: either date could be the wrong one and nothing on the row says
 * which — rewriting either is a guess at a submission date or a signup date
 * (1.1.12).
 *
 * Boundary: reported only when every reading of both dates agrees, so I08's
 * and P60's unresolved orders never decide it; a reference this rule cannot
 * resolve outright is I03's, I04's or I05's, not guessed at here.
 *
 * Tests `submitted_at` and `signup_date`, reports against `submitted_at`
 * (1.1.5); a fix to either column that removes the conflict stops the row.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Both columns' two-number spellings, slash or dash — I06/I07's shapes on
 * `submitted_at`, P58/P59's on `signup_date`. */
const DAY_MONTH_YEAR = /^(\d{1,2})([-/])(\d{1,2})\2(\d{4})$/;

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

/** Every date a cell could be. An ISO cell has one reading; a two-number
 * cell has two, US and day-first. */
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

function isBefore(date: CalendarDate, other: CalendarDate): boolean {
  if (date.year !== other.year) return date.year < other.year;
  if (date.month !== other.month) return date.month < other.month;
  return date.day < other.day;
}

export const i10: CatalogueRule = {
  ruleId: 'I10',
  version: 1,
  ruleName: "Intake submitted date is earlier than the patient's signup date",
  description:
    "This intake's submitted date falls before the signup date of the patient it names, " +
    'so the row claims a submission before that patient signed up. Either date could be ' +
    'the one that is wrong, and nothing on the row says which, so no value is proposed ' +
    'here. Someone who can check the real submission date and signup date has to write ' +
    'in whichever one was mistaken, year-month-day.',
  ambiguous: true,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const intakes = await context.find(LegacyIntake);
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

    for (const intake of intakes) {
      const previousSubmitted = intake.submittedAt;
      const patientId = intake.legacyPatientId;
      if (previousSubmitted === null) continue; // I11's finding.
      if (patientId === null || patientId.trim().length === 0) continue; // I05's finding.
      if (patientId !== patientId.trim()) continue; // I03's finding, not looked up here.

      const submittedReadings = readingsOf(previousSubmitted.trim());
      if (submittedReadings.length === 0) continue; // Not a real date in any reading.

      const matches = patientsById.get(patientId) ?? [];
      if (matches.length === 0) continue; // I04's finding: no patient to compare against.

      const signupReadings = matches.flatMap((patient) =>
        patient.signupDate === null ? [] : readingsOf(patient.signupDate.trim()),
      );
      if (signupReadings.length === 0) continue;

      // True only when every possible reading of the submission precedes
      // every possible reading of every matching patient's signup date.
      const allEarlier = submittedReadings.every((submitted) =>
        signupReadings.every((signup) => isBefore(submitted, signup)),
      );
      if (!allEarlier) continue;

      updates.push({
        table: 'intake' as const,
        legacyId: intake.legacyIntakeId,
        column: 'submitted_at',
        prev: previousSubmitted,
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
