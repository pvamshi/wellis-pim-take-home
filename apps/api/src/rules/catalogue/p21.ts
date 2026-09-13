import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P21 — a patient's `dob` that implies an age under 18 or over 100, so the cell
 * is a perfectly good date and still does not describe a patient this register
 * holds.
 *
 * `2009-02-15` and `2009-03-20` are both in this export and both name a
 * seventeen-year-old. Nothing about them is misspelled: they are ISO, they are
 * real days, they are in the past. What is out of place is the person they
 * describe. The service rejects an intake from anyone under 18, so a patient
 * the old system carried is not one, and a birth year that lands there is far
 * more likely a digit that slipped than a fact about a patient. The far end is
 * the same argument the other way up: a cell claiming a hundred and thirty-six
 * years is a year somebody typed, not a birthday, and the rest of the column
 * agrees — no other date of birth in this export is earlier than the 1950s.
 *
 * Both ends are one rule because they are one sentence: the age this date
 * implies is not an age this register holds. One column, one finding, and one
 * thing a human does about it — check what the patient's date of birth actually
 * is (1.1.4). Splitting it in two would put the same row in front of the same
 * person twice with the same question.
 *
 * Ambiguous, and not repairable by being cleverer. The cell is readable; what
 * it is missing is a reason to believe it:
 *
 * - Which part of the date is wrong is not in the row. `2009` is `1909` typed
 *   without a century's care, or `2000` with a digit slipped, or exactly what
 *   somebody meant. Choosing one is inventing a birth year, which is the thing
 *   1.1.12 keeps out of an ambiguous rule.
 * - The age may be the true fact and the row the mistake — a child's details
 *   typed into a parent's record, a row belonging to somebody the service never
 *   treated, a test entry that was never cleared out. None of those is fixed by
 *   rewriting the date, and this rule cannot tell which one it is looking at.
 * - `signup_date` records when the row was created, not when the patient was
 *   born, so it bounds nothing: a seventeen-year-old and a mistyped year have
 *   the same signup date.
 * - `source` names the funnel, not the automation's date setting, and `import`
 *   is "a bulk load nobody remembers well".
 *
 * So this rule reports and proposes nothing (1.1.12), and its description is
 * the whole of what the human reads. What resolves the row is a person who can
 * check the patient's actual date of birth — from the intake, from the consent
 * log's timestamps, from asking them — and write it in full, ISO. If the age
 * turns out to be right, the row is one for the ops team to decline rather than
 * one for a rule to fix.
 *
 * Where the line is, and why it is there:
 *
 * - **Under 18 and over 100, neither boundary included.** Exactly 18 is an
 *   adult the service takes on, and exactly 100 is an age people genuinely
 *   reach. Seventeen and a hundred and one are the first ages reported on
 *   either side, which is the range the catalogue names read literally.
 * - **Age in completed years, the way a person counts their own.** A patient
 *   whose eighteenth birthday is today is eighteen and is left alone; one whose
 *   eighteenth birthday is tomorrow is still seventeen and is reported.
 * - **A date in the future is P20's, whole.** A day that has not happened
 *   implies no age at all — the patient has not been born — so there is nothing
 *   here to measure, and a cell whose every reading is ahead of today is walked
 *   past. `2059-01-05` is P20's sentence about this column and not this rule's.
 *
 * The spellings, and the readings inside them:
 *
 * - **ISO, and the three day-month spellings.** `2009-02-15`, and a day and a
 *   month on one separator with a four-digit year — `04/22/2018`, `30-12-2015`,
 *   `14.06.2014`. Those are the spellings P16, P17, P18 and P19 name between
 *   them, and the separator has to be the same on both sides: `03-04.2015` is a
 *   mixture nobody writes on purpose and `2015/09/13` is a four-digit year
 *   leading a slash date, which no catalogue entry names either. An implied age
 *   is a fact about the date and not about the punctuation, so all four
 *   spellings are one finding (1.1.4) — including the cells P16 and P17 also
 *   propose an ISO rewrite for, which is their separate sentence about the same
 *   column.
 * - **A two-digit year has no certain age.** `03-04-49` is a patient of
 *   seventy-seven if it is 1949 and unborn if it is 2049, and measuring an age
 *   from one of those is choosing a century — which is exactly what P19 says
 *   nobody here can do. Those cells are P19's, whole.
 * - **A two-way date is measured both ways, and reported only when both
 *   readings are out of range.** `01/04/2015` is a child of eleven whichever
 *   way round its day and month were meant, so the finding is true of the cell
 *   without answering P18's question. `12/01/2008` is seventeen read as the
 *   first of December and eighteen read as the twelfth of January, so this rule
 *   says nothing about it — reporting it would mean picking the reading that
 *   makes the sentence true. The same line holds at the far end, where
 *   `12/01/1925` is a hundred one way round and a hundred and one the other.
 * - **A date that exists.** `2015-02-30` and `02/30/2015` have no such day in
 *   them, so there is no date in the cell to imply an age, and inventing one is
 *   not a fix. Days per month are counted properly, leap years included.
 *
 * **The day the rules run.** Today is read once per run from the clock, so
 * every row in one response is judged against one day and two rows never
 * disagree about when now is. It also means the finding can come and go on its
 * own: a seventeen-year-old's row stops matching on their eighteenth birthday
 * and a hundred-year-old's starts matching on their hundred-and-first, without
 * anybody touching the data. That is a property of a finding about an age, not
 * a fix. What settles a row is a human writing the date of birth they checked,
 * which is what keeps the rule from coming back (1.1.5).
 *
 * An empty cell (P22) is another rule's finding, and a date in the future is
 * P20's. This rule neither checks for them nor excuses itself from a row
 * because of them.
 *
 * The column is only read, and only this one. An implausible date sitting in
 * `signup_date` is another column's business, and `legacy_id` is only how the
 * row is addressed — its own defects are P01's and P02's (1.1.5).
 */

/**
 * The youngest age this register is expected to hold. Eighteen is the age the
 * intake rules draw their own line at, and it is included: an eighteenth
 * birthday makes a patient the service treats, not a finding.
 */
const YOUNGEST_PLAUSIBLE_AGE = 18;

/**
 * The oldest age this register is expected to hold, included for the same
 * reason: a hundred is an age people reach, and a hundred and one is where the
 * catalogue's "over 100" starts.
 */
const OLDEST_PLAUSIBLE_AGE = 100;

/**
 * A full ISO date: four-digit year, two-digit month, two-digit day, dashes.
 * Anchored to the whole trimmed cell. This is what the form tool was switched
 * to in 2024 and what every proposing rule in this column produces, and it is
 * the spelling both of the export's teenagers arrive in.
 *
 * Two digits for the month and the day, not one or two: `2009-2-15` is not ISO,
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
 * match, which is the same line P17, P18, P19 and P20 draw.
 *
 * One or two digits for the day and the month because `1/4/2015` is the same
 * cell written by an automation that did not zero-pad, and the age it implies
 * is the same either way.
 *
 * The year is four digits and no fewer. A two-digit year is P19's: its two
 * centuries are two ages a lifetime apart, so a short year implies no certain
 * age and this rule has nothing certain to say about one.
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
 * and there is no reason to use the short version — 1900 was not a leap year
 * and it is well inside the range this rule reads.
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
 * and the caller reports only when all of them imply an age out of range. A
 * cell that yields nothing is not a date at all, in any order, and no rule in
 * this column reports one of those.
 *
 * When the two numbers are the same, `07/07/2015`, the two readings are the
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
 * How old somebody born on `birth` is on `today`, in completed years — the
 * number a person gives when they are asked their age. The year they turn is
 * only counted once the day itself has come round, so a birthday later this
 * year leaves them a year younger.
 *
 * Only ever called with a birth date that is today or earlier, because a date
 * in the future implies no age at all and is P20's finding.
 */
function ageOn(birth: CalendarDate, today: CalendarDate): number {
  const years = today.year - birth.year;

  const hasHadBirthday =
    today.month > birth.month || (today.month === birth.month && today.day >= birth.day);

  return hasHadBirthday ? years : years - 1;
}

/** True when an age falls outside the range this register is expected to hold. */
function isImplausibleAge(age: number): boolean {
  return age < YOUNGEST_PLAUSIBLE_AGE || age > OLDEST_PLAUSIBLE_AGE;
}

/**
 * The calendar day this run is happening on, taken from the machine clock in
 * local time — the day the person at the console means when they say today.
 */
function todayFrom(clock: Date): CalendarDate {
  return { year: clock.getFullYear(), month: clock.getMonth() + 1, day: clock.getDate() };
}

export const p21: CatalogueRule = {
  ruleId: 'P21',
  version: 1,
  ruleName: 'Patient date of birth implies an age under 18 or over 100',
  description:
    "The patient's date of birth implies an age this register should not hold — under " +
    '18, which is younger than the service treats, or over 100, which is past every ' +
    'other date of birth in the export: 2009-02-15 is a patient of seventeen and ' +
    '05/14/1890 one of a hundred and thirty-six. Both read as dates perfectly well, and ' +
    'nothing in the row says which part of the date is wrong — or whether the age is ' +
    'right and the record belongs to somebody the service never treated — so no date is ' +
    "proposed here. Someone who can check this patient's real date of birth has to " +
    'write it in, year-month-day.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every date of birth
   * whose implied age is under 18 or over 100 (1.1.14). Tests `dob` and reports
   * against `dob` (1.1.5), so a row whose human has written the confirmed date
   * of birth stops matching the next time the rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    // Read once, before the rows. Every age in this response is then measured
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
      // a date at all. A cell that is not a date implies no age.
      if (readings.length === 0) {
        continue;
      }

      // Some reading of the cell has not happened yet, so that reading names no
      // age at all — the patient would not be born. A cell that is entirely in
      // the future is P20's finding, and a cell with one foot either side of
      // today is P18's question about which reading was meant; measuring an age
      // from the reading that happens to be in the past would be answering it.
      if (readings.some((reading) => isAfter(reading, today))) {
        continue;
      }

      // Every reading has to be out of range for the finding to be true of the
      // cell rather than of one way of reading it. `12/01/2008` is seventeen
      // read one way round and eighteen read the other; which was meant is
      // P18's question and stays P18's question.
      if (!readings.every((reading) => isImplausibleAge(ageOn(reading, today)))) {
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
        // No value is proposed, and none can be (1.1.12). Correcting an age
        // means knowing the date of birth, which is the thing in question.
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
