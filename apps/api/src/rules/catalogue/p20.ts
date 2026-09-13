import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P20 — a patient's `dob` that falls after today, so it names a day the patient
 * cannot have been born on.
 *
 * `2059-01-05` and `09/13/2060` are both in this export. Nobody is born in
 * 2060: the cell holds a date, the date parses, and it is still not a date of
 * birth. Several automations plus manual edits wrote this table over the years
 * and one of them put a year in that has not happened yet — a mistyped century,
 * a digit that slipped, a form defaulting to something that was never a
 * birthday.
 *
 * Ambiguous, and not repairable by being cleverer. The cell says what it says
 * and nothing in the export says what it should have said:
 *
 * - The obvious guess — that `2049` was meant to be `1949`, a century typed
 *   wrong — is a convention invented here, not a fact read off the row. `2049`
 *   is just as easily a slipped digit from `2004`, or a year nobody typed on
 *   purpose at all. Writing one of those in would be a hundred-year guess in
 *   somebody's date of birth, which is exactly what 1.1.12 keeps out of an
 *   ambiguous rule.
 * - `signup_date` records when the row was created, not when the patient was
 *   born, so it bounds nothing: a person born in 1949 and a person whose birth
 *   year was fat-fingered have the same signup date.
 * - `source` names the funnel, not the automation's date setting, and `import`
 *   is "a bulk load nobody remembers well".
 * - An implausible implied age would not settle it either. That finding is
 *   P21's, about the same column, and borrowing it here to pick a year would be
 *   that rule's judgement smuggled into this one's proposal.
 *
 * So this rule reports and proposes nothing (1.1.12), and its description is
 * the whole of what the human reads. What resolves the row is a person who can
 * check the patient's actual date of birth — from the intake, from the consent
 * log's timestamps, from asking them — and write it in full, ISO.
 *
 * A date being in the future is a different fact about the cell from how the
 * cell is spelled, so this rule reads every spelling the catalogue names rather
 * than one of them. `09/13/2060` is US-style with a certain order, so P16
 * proposes `2060-09-13` for it and this rule says, about the same column, that
 * the date is still in the future — two rules, two true sentences, one each
 * (1.1.4). P16 and P17 both name this rule for exactly that row.
 *
 * The one thing it will not do is choose a reading in order to find a future.
 * A cell is reported only when *every* date it could be is after today, so the
 * finding never depends on which way round the day and the month were meant:
 *
 * - `01/04/2049` is in the export and reads as the 4th of January 2049 or the
 *   1st of April 2049. Which one is P18's question and stays P18's question;
 *   both of them are twenty years out, so "this date is in the future" is true
 *   of the cell without answering it.
 * - A cell whose two readings straddle today — one already past, one not yet —
 *   is left alone here. Saying it is in the future would mean picking the
 *   reading that makes the sentence true, and the cell does not say which
 *   reading was meant. P18 already speaks for it.
 * - A two-digit year is never certainly in the future: `03-04-49` is 1949 or
 *   2049, and 1949 has been and gone. Those cells are P19's, whole, and this
 *   rule walks past them rather than striking a century out — striking one out
 *   is proposing the other.
 *
 * What else it takes, and what it leaves:
 *
 * - **ISO, and the three day-month spellings.** `2059-01-05`, and a day and a
 *   month on one separator with a four-digit year — `09/13/2060`, `13-09-2060`,
 *   `13.09.2060`. Those are the spellings P16, P17, P18 and P19 name between
 *   them, and the separator has to be the same on both sides: `03-04.2060` is a
 *   mixture nobody writes on purpose, and `2060/09/13` is a four-digit year
 *   leading a slash date, which no catalogue entry names either. Neither is
 *   read further, exactly as the other dob rules leave them.
 * - **A date that exists.** `2060-02-30` and `02/30/2060` have no such day in
 *   them, so there is no date in the cell to be in the future. A cell that is
 *   not a date is not this rule's finding, and inventing one is not a fix. Days
 *   per month are counted properly, leap years included.
 * - **After today, not today.** A date of birth of today is a newborn, not a
 *   mistake, and is walked past. Tomorrow is the first day this rule reports.
 * - **The day the rules run.** Today is read once per run from the clock, so
 *   every row in one response is judged against one day and two rows never
 *   disagree about when now is. It also means a cell can stop matching because
 *   the date arrived rather than because anyone fixed it — `2027-01-01` is a
 *   finding until 2027 — which is a property of the finding and not a fix. What
 *   settles the row is a human writing the real date of birth, which is in the
 *   past and keeps the rule from coming back (1.1.5).
 *
 * An implied age under 18 or over 100 (P21) and an empty cell (P22) are other
 * rules' findings. A future date implies no age at all — the patient has not
 * been born — which is why the catalogue gives it an entry of its own and why
 * this rule neither checks P21's range nor excuses itself from a row because of
 * it.
 *
 * The column is only read, and only this one. A future date sitting in
 * `signup_date` is another column's business — the export has one, and it is
 * not a date of birth — and `legacy_id` is only how the row is addressed; its
 * own defects are P01's and P02's (1.1.5).
 */

/**
 * A full ISO date: four-digit year, two-digit month, two-digit day, dashes.
 * Anchored to the whole trimmed cell. This is what the form tool was switched
 * to in 2024 and what every proposing rule in this column produces, so it is
 * the spelling a future date most often arrives in — `2059-01-05` is in the
 * export.
 *
 * Two digits for the month and the day, not one or two: `2059-1-5` is not ISO,
 * and no rule in this column writes it.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Three numbers on one separator — a slash, a dash or a dot: one or two digits,
 * one or two digits, then four. Anchored to the whole trimmed cell, so anything
 * with a word, a time, a fourth part or a stray separator in it is not this
 * shape.
 *
 * The second separator is a backreference to the first, so the two have to
 * match, which is the same line P17, P18 and P19 draw.
 *
 * One or two digits for the day and the month because `1/4/2049` is the same
 * cell written by an automation that did not zero-pad, and a year in the future
 * is in the future either way.
 *
 * The year is four digits and no fewer. A two-digit year is P19's: its 1900s
 * reading is always in the past, so a short year is never certainly a future
 * date and this rule has nothing certain to say about one.
 */
const DAY_MONTH_YEAR = /^(\d{1,2})([-./])(\d{1,2})\2(\d{4})$/;

/** Days in each month, January first, February's leap day added separately. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** One date on the calendar. The month is 1-based, as people write it. */
interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/**
 * The Gregorian leap rule, in full: every fourth year, except centuries, except
 * every fourth century. The year is four digits here, so the century is known
 * and there is no reason to use the short version — 2100 is not a leap year.
 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** How many days that month had in that year. The month is 1-based. */
function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }

  return DAYS_IN_MONTH[month - 1] ?? 0;
}

/** True when these three numbers are a day that existed, or will exist. */
function isRealDate(date: CalendarDate): boolean {
  if (date.month < 1 || date.month > 12) {
    return false;
  }

  return date.day >= 1 && date.day <= daysInMonth(date.year, date.month);
}

/**
 * Every date this cell could be, with the ones that are not dates dropped.
 *
 * An ISO cell has one reading. A day-and-month cell has two — the US order and
 * the European one — and this rule never chooses between them: it returns both
 * and the caller reports only when all of them are in the future. A cell that
 * yields nothing is not a date at all, in any order, and no rule in this column
 * reports one of those.
 *
 * When the two numbers are the same, `07/07/2044`, the two readings are the
 * same date. Returning it twice costs nothing and asking the same question
 * twice gives the same answer.
 */
function readingsOf(cell: string): CalendarDate[] {
  const iso = ISO_DATE.exec(cell);

  if (iso !== null) {
    const isoDate = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };

    return isRealDate(isoDate) ? [isoDate] : [];
  }

  const numbers = DAY_MONTH_YEAR.exec(cell);

  // Not ISO and not three numbers on one separator with a four-digit year: a
  // two-digit year (P19), a mixed separator, an empty cell (P22), or something
  // that is not a date at all.
  if (numbers === null) {
    return [];
  }

  const year = Number(numbers[4]);
  const first = Number(numbers[1]);
  const second = Number(numbers[3]);

  return [
    // US-style, month first — the order P16 names for the slash spelling.
    { year, month: first, day: second },
    // European, day first — the order P17 names for dashes and dots.
    { year, month: second, day: first },
  ].filter(isRealDate);
}

/** True when the first date falls strictly after the second. */
function isAfter(date: CalendarDate, other: CalendarDate): boolean {
  if (date.year !== other.year) {
    return date.year > other.year;
  }

  if (date.month !== other.month) {
    return date.month > other.month;
  }

  return date.day > other.day;
}

/**
 * The calendar day this run is happening on, taken from the machine clock in
 * local time — the day the person at the console means when they say today.
 */
function todayFrom(clock: Date): CalendarDate {
  return { year: clock.getFullYear(), month: clock.getMonth() + 1, day: clock.getDate() };
}

export const p20: CatalogueRule = {
  ruleId: 'P20',
  version: 1,
  ruleName: 'Patient date of birth is in the future',
  description:
    "The patient's date of birth falls after today, so it names a day this patient " +
    'cannot have been born on: 2059-01-05 is a birth date decades from now, and ' +
    '01/04/2049 is one whichever way round its day and month are read. Nothing in the ' +
    'row says what the date should have been — a year in the future could be a mistyped ' +
    'century, a slipped digit or a value nobody typed on purpose — so no date is ' +
    "proposed here. Someone who can check this patient's real date of birth has to " +
    'write it in, year-month-day.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every date that falls
   * after today (1.1.14). Tests `dob` and reports against `dob` (1.1.5), so a
   * row whose human has written the confirmed date of birth — a real date, in
   * the past — stops matching the next time the rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    // Read once, before the rows. Every finding in this response is then judged
    // against the same day, however long the run takes.
    const today = todayFrom(new Date());

    for (const patient of patients) {
      const previous = patient.dob;

      // No date in the column at all. An empty cell is P22's finding, and this
      // rule has nothing to read.
      if (previous === null) {
        continue;
      }

      const readings = readingsOf(previous.trim());

      // Nothing in the cell is a date: a spelling no catalogue entry names, a
      // two-digit year (P19), an empty cell (P22), the 30th of February, or not
      // a date at all. A cell that is not a date is not a date in the future.
      if (readings.length === 0) {
        continue;
      }

      // Some reading of the cell is today or earlier, so the cell may well be a
      // perfectly good date of birth. `12/01/2026` read one way round is next
      // December and read the other was last January — which of the two was
      // meant is P18's question, and answering it here in order to call the row
      // a future date would be a guess wearing this rule's name.
      if (!readings.every((reading) => isAfter(reading, today))) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `dob`, so the id
        // is only the address of the row — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'dob',
        // Reported exactly as stored, padding and separator and all, because
        // the cell as written is the whole of what the human has to go on when
        // they work out what this date was meant to be.
        prev: previous,
        // No value is proposed, and none can be (1.1.12). Correcting a year
        // that has not happened yet means knowing the year that did.
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
