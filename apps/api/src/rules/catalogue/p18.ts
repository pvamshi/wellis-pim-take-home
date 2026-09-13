import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P18 — a patient's `dob` whose two leading numbers are both 12 or under, so
 * the US reading and the European reading are both dates and the cell does not
 * say which was meant.
 *
 * `03/04/1989` is the 4th of March read US-style and the 3rd of April read
 * European-style. Both months exist, both days exist, and both are somebody's
 * real birthday. This is the caveat the export notes warn about in as many
 * words: the form tool was set to ISO at some point in 2024, before that it
 * depended on which automation wrote the row, "at least one of them was
 * configured US-style", and "nobody remembers exactly when what changed". A
 * date whose two numbers are both 12 or under is exactly the row where that
 * missing memory bites.
 *
 * Ambiguous, and not repairable by being cleverer. The two readings are eleven
 * months apart at most and one day apart at least, and nothing in the export
 * decides between them:
 *
 * - `source` names the funnel, not the automation's date setting, and `import`
 *   is "a bulk load nobody remembers well".
 * - `signup_date` is written by the same automations with the same unremembered
 *   settings, so reading the order off it would launder one guess into another.
 * - Other rows are no help either: several automations plus manual edits wrote
 *   this table over the years, so a table-wide majority would impose one
 *   automation's habit on another automation's rows.
 * - A day that would be implausible under one reading is still a real date. The
 *   implausible-age finding is P21's, about the same column, and using it here
 *   to pick a reading would be that rule's judgement smuggled into this one's
 *   proposal.
 *
 * So this rule reports and proposes nothing (1.1.12), and its description is
 * the whole of what the human reads. What resolves the row is a person who can
 * check the patient's actual date of birth — from the intake, from the consent
 * log's timestamps, from asking them — and write it ISO.
 *
 * This is the other half of the line P16 and P17 draw. Those two take only the
 * dates where one of the two readings is arithmetically impossible — a number
 * above 12 cannot be a month — and each of them hands the rest here by name.
 * Between the three rules every ordinary two-number date is spoken for exactly
 * once: certain and US-spelled is P16's fix, certain and European-spelled is
 * P17's fix, and uncertain is this rule's question (1.1.4).
 *
 * What it takes, and what it leaves:
 *
 * - **Slashes, dashes and dots.** The ambiguity is in the numbers, not in the
 *   punctuation, so it is the same finding whichever of the three spellings
 *   the automation used — `03/04/1989`, `03-04-1989` and `03.04.1989` are one
 *   problem with one sentence about it, which is why they are one rule and not
 *   three (1.1.4). P16 owns the slash spelling and P17 the dash and dot ones
 *   only because their *proposals* differ by spelling; this rule proposes
 *   nothing, so it has nothing to split. The separator still has to be the same
 *   on both sides: `03-04.1989` is a mixture nobody writes on purpose and is
 *   not read further, exactly as P17 leaves it.
 * - **Both numbers 1 to 12.** 12 is the last number that can be a month, so
 *   `12-11-1995` is this rule's and `13-06-1985` is P17's — 13 cannot be a
 *   month, which settles the order and lets that rule propose a value. A zero
 *   in either place, `00-12-1975` or `03-00-1989`, is left alone by all three:
 *   no reading of it is a date and there is nothing to report that would not be
 *   invented.
 * - **A four-digit year.** `03-04-89` is P19's finding — ambiguous for its own
 *   reason, that 89 is 1989 or 2089 — and the catalogue gives the two-digit
 *   year to that rule. Requiring four digits here is the same line P16 and P17
 *   draw, and it keeps one cell from being asked about twice in the same
 *   breath.
 * - **Already ISO** — `2000-01-22` — is walked past: its first number is the
 *   four-digit year, not a one- or two-digit day, so it is not this shape. That
 *   is also what makes the rule self-terminating (1.1.5): once a human writes
 *   the date they confirmed, the row does not come back.
 *
 * One row deserves saying out loud: `07-07-1984`, where the two numbers are the
 * same. Both readings still parse, which is the catalogue's condition word for
 * word, and they happen to land on the same day — so the order is still not
 * recoverable from the cell, and it still makes no difference. It is reported
 * here anyway, for two reasons. Ambiguity is rule-wide (1.1.12), so this rule
 * cannot quietly propose a value for the rows where the two readings agree and
 * ask about the rest. And nothing else in the catalogue would take the row:
 * P16 wants a day above 12 and P17 a first number above 12, so a cell excluded
 * here would be a non-ISO date that no rule ever mentions. A human confirming a
 * date they can already see is a cheap sentence; a date of birth nobody is ever
 * shown is not.
 *
 * A date in the future (P20), an implied age under 18 or over 100 (P21) and an
 * empty cell (P22) are other rules' findings, and this rule neither checks for
 * them nor excuses itself from a row because of them.
 *
 * The column is only read, and only this one. A two-number date sitting in
 * `signup_date` is another column's business, and `legacy_id` is only how the
 * row is addressed — its own defects are P01's and P02's (1.1.5).
 */

/**
 * Three numbers on one separator — a slash, a dash or a dot: one or two digits,
 * one or two digits, then four. Anchored to the whole trimmed cell, so anything
 * with a word, a time, a fourth part or a stray separator in it is not this
 * shape.
 *
 * The second separator is a backreference to the first, so the two have to
 * match. A cell that starts with a dash and ends with a dot is none of the
 * spellings the catalogue names, here or in P16 and P17.
 *
 * One or two digits rather than strictly two because `3-4-1989` is the same
 * two-way cell written by an automation that did not zero-pad; the ambiguity is
 * in the numbers and padding does not change them.
 *
 * The year is four digits and no fewer. Two digits is P19's finding.
 */
const TWO_NUMBER_DATE = /^(\d{1,2})([-./])(\d{1,2})\2(\d{4})$/;

/**
 * True when the number could be a month: 1 to 12. Both numbers passing this is
 * the whole of the finding — each one can be the month, so each one can be the
 * day, and both readings land on a day that exists in every month.
 */
function couldBeMonth(value: number): boolean {
  return value >= 1 && value <= 12;
}

export const p18: CatalogueRule = {
  ruleId: 'P18',
  version: 1,
  ruleName: 'Patient date of birth reads as a date both ways round',
  description:
    "The patient's date of birth has two numbers that are both 12 or under, so it is a " +
    'real date read either way round: 03/04/1989 is the 4th of March if the automation ' +
    'that wrote it was set US-style and the 3rd of April if it was set European-style. ' +
    'The export notes say both kinds of automation wrote this table and nobody remembers ' +
    'which wrote when, and nothing else in the row settles it — so no date is proposed ' +
    'here. Someone who can check the real date of birth for this patient has to write ' +
    'it in, year-month-day.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every two-way date
   * (1.1.14). Tests `dob` and reports against `dob` (1.1.5), so a row whose
   * human has written the confirmed date in ISO stops matching the next time
   * the rules run.
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

      const matched = TWO_NUMBER_DATE.exec(previous.trim());

      // Not three numbers on one separator with a four-digit year: an ISO date
      // already, a two-digit year (P19), an empty cell (P22), or something that
      // is not a date at all. None of them is this shape and none is read
      // further.
      if (matched === null) {
        continue;
      }

      const first = Number(matched[1]);
      const second = Number(matched[3]);

      // One of the two numbers is above 12 or is zero. Above 12 means only one
      // reading parses, and the order is certain — that is P16's fix on the
      // slash spelling and P17's on the dash and dot ones, and both of them
      // propose a value precisely because there is nothing to choose. Zero
      // means neither reading is a date, and no rule invents one.
      if (!couldBeMonth(first) || !couldBeMonth(second)) {
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
        // they work out which of the two dates was meant.
        prev: previous,
        // No value is proposed, and none can be (1.1.12). Proposing either
        // reading would be a coin toss written into a date of birth.
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
