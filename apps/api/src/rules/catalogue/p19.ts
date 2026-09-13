import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P19 — a patient's `dob` whose year is written with two digits, so the century
 * is not in the cell at all.
 *
 * `03-04-54` ends in a year that is 1954 or 2054, and the two are a hundred
 * years apart. The export notes say several automations wrote this table over
 * the years plus occasional manual edits, and a two-digit year is what one of
 * them produced: the digits that were dropped were dropped at the source and no
 * later reading puts them back.
 *
 * Ambiguous, and not repairable by being cleverer. Nothing in the export
 * carries the missing century:
 *
 * - `signup_date` records when the row was created, not when the patient was
 *   born, so it says nothing about which century a birth year belongs to.
 * - `source` names the funnel, not the automation's date setting, and `import`
 *   is "a bulk load nobody remembers well".
 * - The usual trick — a sliding window that reads years above some cut-off as
 *   1900s and the rest as 2000s — is a convention invented here, not a fact
 *   read off the row. It would rewrite a date of birth by a hundred years and
 *   it would be right or wrong silently, which is exactly the kind of proposal
 *   1.1.12 exists to keep out of an ambiguous rule.
 * - An implausible implied age would not settle it either. That finding is
 *   P21's, about the same column, and borrowing it here to choose a century
 *   would be that rule's judgement smuggled into this one's proposal.
 *
 * So this rule reports and proposes nothing (1.1.12), and its description is
 * the whole of what the human reads. What resolves the row is a person who can
 * check the patient's actual date of birth — from the intake, from the consent
 * log's timestamps, from asking them — and write it in full, ISO.
 *
 * This is the cell P16, P17 and P18 each hand over by name. All three require a
 * four-digit year precisely because none of them can tell 1954 from 2054, so a
 * two-digit year reaches this rule and no other. That is why this rule takes
 * both orders and all three separators: it is the only entry speaking for the
 * cell, and a two-digit year is the finding whichever way round the day and the
 * month were written.
 *
 * What it takes, and what it leaves:
 *
 * - **Slashes, dashes and dots.** The missing century is in the year, not in
 *   the punctuation, so `03/04/54`, `03-04-54` and `03.04.54` are one problem
 *   with one sentence about it, which is why they are one rule and not three
 *   (1.1.4). The separator still has to be the same on both sides: `03-04.54`
 *   is a mixture nobody writes on purpose and is not read further, exactly as
 *   P17 and P18 leave it.
 * - **A year of exactly two digits.** Four digits is P16's, P17's or P18's
 *   finding depending on the order and the separator, and none of those is this
 *   rule's business. Three digits is no year anybody wrote and is walked past.
 * - **Either order, certain or not.** `14-08-82` reads only one way — there is
 *   no month 14 — and is still reported here, because the order was never what
 *   was missing. `03-04-54` is reported for the same reason as the rest of
 *   them, even though its two numbers are also a two-way date: P18 requires a
 *   four-digit year, so it is silent on this cell, and one rule saying one true
 *   thing about it is what 1.1.4 asks for. A human who checks the real date of
 *   birth and writes it out in full settles the century and the order together.
 * - **A day and a month that exist, in one order or the other.** `20-13-54` is
 *   no date either way round, `00-12-54` has a zero where a day would go, and
 *   `31-04-54` is the 31st of a month with thirty days. No reading of any of
 *   them is a date, so there is nothing to report that would not be invented —
 *   the same cells P16, P17 and P18 all walk past. The 29th of February counts
 *   as a real day when the two-digit year divides by four: 2000 was a leap year
 *   even though 1900 was not, so for `29-02-96` one century or the other always
 *   gives the day, while `29-02-54` is a day neither 1954 nor 2054 had.
 * - **A day and a month, in that position.** `89-04-03` is left alone: 89 is
 *   neither a day nor a month, so the cell is not a day and a month followed by
 *   a short year. A leading two-digit year is a spelling no catalogue entry
 *   names, and guessing that the first number is the year would be inventing a
 *   shape rather than reading one.
 * - **Already ISO** — `2000-01-22` — is walked past: its year is four digits
 *   and leads the cell. That is also what makes the rule self-terminating
 *   (1.1.5): once a human writes the date they confirmed, the row does not come
 *   back.
 *
 * A date in the future (P20), an implied age under 18 or over 100 (P21) and an
 * empty cell (P22) are other rules' findings, and this rule neither checks for
 * them nor excuses itself from a row because of them. `03-04-54` read as 2054
 * would be in the future and read as 1954 would not; this rule does not use
 * that to strike a century out, because striking one out is proposing the other
 * and it proposes nothing at all (1.1.12).
 *
 * The column is only read, and only this one. A two-digit year sitting in
 * `signup_date` is another column's business, and `legacy_id` is only how the
 * row is addressed — its own defects are P01's and P02's (1.1.5).
 */

/**
 * Three numbers on one separator — a slash, a dash or a dot: one or two digits,
 * one or two digits, then exactly two. Anchored to the whole trimmed cell, so
 * anything with a word, a time, a fourth part or a stray separator in it is not
 * this shape.
 *
 * The second separator is a backreference to the first, so the two have to
 * match. A cell that starts with a dash and ends with a dot is none of the
 * spellings the catalogue names, here or in P16, P17 and P18.
 *
 * One or two digits for the day and the month because `3-4-54` is the same
 * short-year cell written by an automation that did not zero-pad; the century
 * is missing either way and padding does not put it back.
 *
 * The year is two digits and exactly two. Four digits is P16's, P17's or P18's,
 * and a cell is never asked about twice in the same breath.
 */
const SHORT_YEAR_DATE = /^(\d{1,2})([-./])(\d{1,2})\2(\d{2})$/;

/** Days in each month, January first, February's leap day added separately. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Whether a two-digit year could be a leap year under either century, which is
 * the most this rule can know about it.
 *
 * Divisible by four is the whole test. For every two-digit year but `00` the
 * 1900s and the 2000s agree — 1996 and 2096 are both leap years, 1954 and 2054
 * are both not — and `00` divides by four and is the one case where they
 * disagree: 1900 was not a leap year and 2000 was, so one century still gives
 * the day. A rule that demanded certainty here would drop `29-02-00`, a date
 * that exists as 2000-02-29.
 */
function couldBeLeapYear(twoDigitYear: number): boolean {
  return twoDigitYear % 4 === 0;
}

/** How many days that month could have had. The month is 1-based. */
function daysInMonth(twoDigitYear: number, month: number): number {
  if (month === 2 && couldBeLeapYear(twoDigitYear)) {
    return 29;
  }

  return DAYS_IN_MONTH[month - 1] ?? 0;
}

/**
 * True when this day-and-month pair is a real date in some year the two digits
 * could stand for. Both readings of the cell are tried against it, and a cell
 * that fails both is not a date at all — no rule in the catalogue reports one
 * of those, and this rule does not start.
 */
function isRealDate(day: number, month: number, twoDigitYear: number): boolean {
  if (month < 1 || month > 12) {
    return false;
  }

  return day >= 1 && day <= daysInMonth(twoDigitYear, month);
}

export const p19: CatalogueRule = {
  ruleId: 'P19',
  version: 1,
  ruleName: 'Patient date of birth has a two-digit year',
  description:
    "The patient's date of birth ends in a two-digit year, so the century is missing " +
    'from the cell: 03-04-54 is 1954 or 2054, a hundred years apart, and nothing else ' +
    'in the row says which. No year is proposed here — picking a century would be a ' +
    "guess written into somebody's date of birth. Someone who can check this patient's " +
    'real date of birth has to write it in full, year-month-day.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every date whose year
   * is two digits (1.1.14). Tests `dob` and reports against `dob` (1.1.5), so a
   * row whose human has written the confirmed date in ISO — four-digit year,
   * year first — stops matching the next time the rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
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

      const matched = SHORT_YEAR_DATE.exec(previous.trim());

      // Not three numbers on one separator ending in a two-digit year: an ISO
      // date already, a four-digit year (P16, P17 and P18 between them), an
      // empty cell (P22), or something that is not a date at all. None of them
      // is this shape and none is read further.
      if (matched === null) {
        continue;
      }

      const first = Number(matched[1]);
      const second = Number(matched[3]);
      const year = Number(matched[4]);

      // Neither way round is a date: a number that is no month on either side,
      // a zero where a day would go, or a day that month never had. There is
      // nothing to report here that would not be invented, which is the same
      // line P16, P17 and P18 draw on cells of this kind.
      if (!isRealDate(first, second, year) && !isRealDate(second, first, year)) {
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
        // they work out which date this was meant to be.
        prev: previous,
        // No value is proposed, and none can be (1.1.12). Proposing a century
        // would be a hundred-year guess written into a date of birth.
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
