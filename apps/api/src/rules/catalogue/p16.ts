import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P16 — a patient's `dob` written US-style, `MM/DD/YYYY`, where the day is
 * greater than 12 and so the order of the two numbers is certain.
 *
 * The export notes say the form tool was switched to ISO at some point in 2024,
 * that before then it depended on which automation wrote the row, and that "at
 * least one of them was configured US-style". `02/16/1962` is one of those rows.
 * Read the European way it says the 2nd day of month 16, and there is no month
 * 16 — so the first number is the month, the second is the day, and the date is
 * the 16th of February 1962. The proposal is that date written ISO:
 * `1962-02-16`.
 *
 * Not ambiguous, and the reason is arithmetic rather than judgement. A day
 * above 12 cannot be a month, so only one of the two readings parses at all.
 * The rule never prefers US order, never leans on `source`, `signup_date` or
 * any guess about which automation wrote the row — it takes only the dates
 * where the alternative reading is impossible, and leaves every date where both
 * readings work to P18, which is ambiguous precisely because nobody can tell
 * those apart. That split is the whole of why this rule can propose a value and
 * P18 cannot.
 *
 * What it takes, and what it leaves:
 *
 * - **Slashes, and only slashes.** `MM/DD/YYYY` is the separator the catalogue
 *   names for the US-style rows. `14-08-1982` and `14.08.1982` are P17's — the
 *   European spellings, unambiguous but not ISO — and a rule that swallowed
 *   every separator would be two fixes wearing one name (1.1.4) and would put
 *   two rules on the same row.
 * - **The day above 12, the month 1 to 12.** `03/04/1972` is left to P18: the
 *   3rd of April and the 4th of March both exist, and choosing between them is
 *   a human's call, not this rule's. `13/25/1990` is left alone by both — no
 *   reading of it is a date, and inventing one is not a fix.
 * - **A four-digit year.** A two-digit year is P19's finding, and ambiguous for
 *   its own reason: `54` is 1954 or 2054 and the century is not recoverable
 *   from the cell.
 * - **A date that exists.** `02/30/1990` has the certain order and no such day,
 *   so there is no ISO date to propose and this rule proposes nothing. Days per
 *   month are counted properly, leap years included, so `02/29/1996` is
 *   proposed and `02/29/1997` is not.
 * - **Already ISO** — `2000-01-22` — is what this rule exists to produce, and
 *   is walked past. That is also what makes it self-terminating: the proposed
 *   value carries no slashes, so an approved row never matches again (1.1.5).
 *
 * A date in the future (P20), an implied age under 18 or over 100 (P21) and an
 * empty cell (P22) are other rules' findings, and this rule neither checks for
 * them nor excuses itself from a row because of them. `07/23/2090` is US-style
 * with a certain order, so its ISO spelling is proposed here; that the year is
 * still in the future is P20's sentence to write, about the same column, after
 * or before this one — each rule says one true thing about the cell (1.1.4).
 *
 * The column is read and the same column is proposed against (1.1.5). A date
 * written into `signup_date` or a name is another column's business, and
 * `legacy_id` is only how the row is addressed — its own defects are P01's and
 * P02's.
 */

/**
 * Three numbers separated by slashes: one or two digits, one or two digits,
 * then four. Anchored to the whole trimmed cell, so anything with a word, a
 * time, a fourth part or a second separator in it is not this shape.
 *
 * One or two digits rather than strictly two because `7/23/1961` is the same
 * date, written the same way round, by an automation that did not zero-pad. The
 * catalogue's `MM/DD/YYYY` names the order of the parts, which is what makes
 * the reading certain; the padding is spelling.
 *
 * The year is four digits and no fewer. Two digits is P19's, and this rule
 * cannot tell 1954 from 2054 any better than that rule can.
 */
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** Days in each month, January first, February's leap day added separately. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * The Gregorian leap rule, in full: every fourth year, except centuries, except
 * every fourth century. 1900 is not a leap year and 2000 is, and a rule that
 * used the short version would propose the 29th of February 1900 — a day that
 * has never existed.
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

/** Two digits, which is what an ISO date wants for its month and its day. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export const p16: CatalogueRule = {
  ruleId: 'P16',
  version: 1,
  ruleName: 'Patient date of birth is US-style with a certain order',
  description:
    "The patient's date of birth is written US-style, month first and separated by " +
    'slashes, and its second number is greater than 12 — so it cannot be a month, the ' +
    'order of the two numbers is certain, and the date has only one reading. The same ' +
    'date written ISO, year-month-day, is proposed. Dates where both numbers are 12 or ' +
    'under are not touched here: those have two readings and no way to choose between ' +
    'them.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every certain-order
   * US-style date, rewritten ISO (1.1.14). Tests `dob` and changes `dob`
   * (1.1.5), and the value it proposes has no slashes in it, so an approved row
   * stops matching the next time the rules run.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.dob;

      // No date in the column at all. An empty cell is P22's finding, and this
      // rule has nothing to read.
      if (previous === null) {
        continue;
      }

      const matched = SLASH_DATE.exec(previous.trim());

      // Not three slash-separated numbers with a four-digit year: an ISO date
      // already, a European spelling with dashes or dots (P17), a two-digit
      // year (P19), an empty cell (P22), or something that is not a date at
      // all. None of them is this shape and none is read further.
      if (matched === null) {
        continue;
      }

      const month = Number(matched[1]);
      const day = Number(matched[2]);
      const year = Number(matched[3]);

      // The first number is not a month either, so neither reading of the cell
      // is a date. `13/25/1990` is nobody's fix — there is nothing to propose
      // that would not be invented.
      if (month < 1 || month > 12) {
        continue;
      }

      // Both numbers are 12 or under, so US and European readings both parse
      // and both are dates. That is P18's finding, and it is ambiguous because
      // the cell genuinely does not say which was meant.
      if (day <= 12) {
        continue;
      }

      // The order is certain and the date still does not exist — the 30th of
      // February, the 31st of April, the 29th of a February that had 28 days.
      // There is no ISO date to propose, so none is.
      if (day > daysInMonth(year, month)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `dob`, so the id
        // is only the address of the row — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'dob',
        // Reported exactly as stored, padding and all, so a human comparing the
        // two sees the cell they would see in the row.
        prev: previous,
        // The one date the cell can mean, written ISO. The whole cell is
        // replaced, because the fix is the date rewritten rather than a piece
        // of the old spelling edited — which is why any padding around it goes
        // with the spelling it belonged to.
        next: `${matched[3]}-${pad(month)}-${pad(day)}`,
      });
    }

    return { ambiguity: false, updates };
  },
};
