import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P17 — a patient's `dob` written European-style, `DD-MM-YYYY` or
 * `DD.MM.YYYY`, where the first number is greater than 12 and so the order of
 * the two numbers is certain.
 *
 * The export notes say the form tool was switched to ISO at some point in 2024,
 * and that before then it depended on which automation wrote the row.
 * `14-08-1982` is one of the rows from before: read the US way it says month
 * 14, and there is no month 14 — so the first number is the day, the second is
 * the month, and the date is the 14th of August 1982. The proposal is that date
 * written ISO: `1982-08-14`.
 *
 * Not ambiguous, and the reason is arithmetic rather than convention. A number
 * above 12 cannot be a month, so only one of the two readings parses at all.
 * The rule never treats the separator as evidence of order, never leans on
 * `source`, `signup_date` or any guess about which automation wrote the row —
 * it takes only the dates where the alternative reading is impossible, and
 * leaves every date where both readings work to P18, which is ambiguous
 * precisely because nobody can tell those apart. That split is the whole of why
 * this rule can propose a value and P18 cannot, and it is the same line P16
 * draws on the slash-separated rows.
 *
 * What it takes, and what it leaves:
 *
 * - **Dashes and dots, and only those.** `DD-MM-YYYY` and `DD.MM.YYYY` are the
 *   two spellings the catalogue names here, and the separator has to be the
 *   same on both sides — `14-08.1982` is a mixture nobody writes on purpose and
 *   is not read further. `02/16/1962` is P16's, the US-style slash spelling,
 *   and a rule that swallowed every separator would be two fixes wearing one
 *   name (1.1.4) and would put two rules on the same row.
 * - **The first number above 12, the second 1 to 12.** `03-04-1989` is left to
 *   P18: the 3rd of April and the 4th of March both exist, and choosing between
 *   them is a human's call, not this rule's. `20-13-1971` is left alone by
 *   both — no reading of it is a date, and inventing one is not a fix.
 * - **Day first, and only day first.** `08-14-1982` — a dash date whose
 *   *second* number is above 12 — is not `DD-MM-YYYY`; there is no month 14, so
 *   it is not the shape this rule is for. The catalogue gives the US order to
 *   the slash spelling and nothing else, so this rule proposes nothing for it
 *   rather than inventing a reading no entry asked for.
 * - **A four-digit year.** A two-digit year is P19's finding, and ambiguous for
 *   its own reason: `54` is 1954 or 2054 and the century is not recoverable
 *   from the cell.
 * - **A date that exists.** `31-04-1990` has the certain order and no such day,
 *   so there is no ISO date to propose and this rule proposes nothing. Days per
 *   month are counted properly, leap years included, so `29-02-1980` is
 *   proposed and `29-02-1997` is not.
 * - **Already ISO** — `2000-01-22` — is what this rule exists to produce, and
 *   is walked past: its first number is the four-digit year, not a one- or
 *   two-digit day. That is also what makes it self-terminating, so an approved
 *   row never matches again (1.1.5).
 *
 * A date in the future (P20), an implied age under 18 or over 100 (P21) and an
 * empty cell (P22) are other rules' findings, and this rule neither checks for
 * them nor excuses itself from a row because of them. `23-07-2090` is European
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
 * Three numbers separated by dashes or by dots: one or two digits, one or two
 * digits, then four. Anchored to the whole trimmed cell, so anything with a
 * word, a time, a fourth part or a stray separator in it is not this shape.
 *
 * The second separator is a backreference to the first, so the two have to
 * match: a cell that starts with a dash and ends with a dot is neither of the
 * spellings the catalogue names.
 *
 * One or two digits rather than strictly two because `7-3-1981` is the same
 * date, written the same way round, by an automation that did not zero-pad. The
 * catalogue's `DD-MM-YYYY` names the order of the parts, which is what makes
 * the reading certain; the padding is spelling.
 *
 * The year is four digits and no fewer. Two digits is P19's, and this rule
 * cannot tell 1954 from 2054 any better than that rule can.
 */
const EUROPEAN_DATE = /^(\d{1,2})([-.])(\d{1,2})\2(\d{4})$/;

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

export const p17: CatalogueRule = {
  ruleId: 'P17',
  version: 1,
  ruleName: 'Patient date of birth is European-style with a certain order',
  description:
    "The patient's date of birth is written European-style, day first and separated by " +
    'dashes or dots, and its first number is greater than 12 — so it cannot be a month, ' +
    'the order of the two numbers is certain, and the date has only one reading. The ' +
    'same date written ISO, year-month-day, is proposed. Dates where both numbers are ' +
    '12 or under are not touched here: those have two readings and no way to choose ' +
    'between them.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every certain-order
   * European date, rewritten ISO (1.1.14). Tests `dob` and changes `dob`
   * (1.1.5), and the value it proposes starts with a four-digit year, so an
   * approved row stops matching the next time the rules run.
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

      const matched = EUROPEAN_DATE.exec(previous.trim());

      // Not three numbers on one separator with a four-digit year: an ISO date
      // already, a US-style slash spelling (P16), a two-digit year (P19), an
      // empty cell (P22), or something that is not a date at all. None of them
      // is this shape and none is read further.
      if (matched === null) {
        continue;
      }

      const day = Number(matched[1]);
      const month = Number(matched[3]);
      const year = Number(matched[4]);

      // Both numbers are 12 or under, so day-first and month-first readings
      // both parse and both are dates. That is P18's finding, and it is
      // ambiguous because the cell genuinely does not say which was meant. A
      // leading zero-day such as `00-12-1975` falls out here too: it is no
      // date either way round, and there is nothing to propose.
      if (day <= 12) {
        continue;
      }

      // The second number is not a month, so the day-first reading does not
      // parse either. `20-13-1971` is nobody's fix — there is nothing to
      // propose that would not be invented.
      if (month < 1 || month > 12) {
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
        next: `${matched[4]}-${pad(month)}-${pad(day)}`,
      });
    }

    return { ambiguity: false, updates };
  },
};
