import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P22 — a patient row with no `dob` at all: the column absent, the cell empty,
 * or the cell holding nothing but whitespace.
 *
 * A date of birth is the one value in this row that says how old the patient
 * is, and the service draws a line at that: it treats adults, and P21 reports
 * the rows whose implied age falls outside what this register should hold. A
 * row with no date cannot be checked against that line at all — it is not a
 * patient of a plausible age, and it is not a patient of an implausible one
 * either; nobody knows. It is also half of what D03 matches duplicates on — the
 * same normalised name and the same `dob` — so the second signup that is the
 * same person under a different email cannot be found from this side of the
 * pair. And P62 asks whether a signup date is earlier than the patient's own
 * birth, a question with nothing to compare against here.
 *
 * The other six rules in this column all read a cell and say something about
 * the date in it. This one is the case where there is no date to read, which is
 * why it is a rule of its own (1.1.4): the sentence a human needs is not "this
 * date is wrong" but "this row never had one".
 *
 * Ambiguous, and not marginally so. A birth date is not derivable from anything
 * else the export holds:
 *
 * - `signup_date` records when the row was created, not when the patient was
 *   born. It bounds nothing usable — every adult patient was born some time
 *   before they signed up, which is a range of eighty years.
 * - `full_name`, `email`, `city` and `phone` identify a person without dating
 *   their birth.
 * - `bsn` is a citizen service number, not an encoding of a birthday, and the
 *   notes say it was never validated in the first place.
 * - Another row with the same name is not the same person until D03 says so,
 *   and D03 needs this very value to say it.
 *
 * Filling the column from any of those would invent a birthday, and a birthday
 * is what the age gate and the duplicate match are both decided on. So this
 * rule reports and proposes nothing (1.1.12), and its description is the whole
 * of what the human reads. What resolves the row is a person who can look up
 * the patient's actual date of birth — from the intake, from the consent log,
 * from asking them — and write it in, year-month-day.
 *
 * Three ways a cell arrives with no date in it, and all three are this rule's:
 *
 * - `null`, because `dob` is nullable and a row whose source had no such column
 *   lands that way.
 * - `''`, an empty cell in `patients.csv`.
 * - whitespace only, a cell somebody typed a space or a tab into.
 *
 * The last one is not this rule widening itself. P16 through P21 each read the
 * trimmed cell and look for a date in it; whitespace leaves nothing to read, so
 * all six walk past, and without this rule a blank-looking date of birth would
 * have no rule at all. No rule in this column proposes a trim on its own —
 * padding around a real date is carried into the ISO value P16 and P17 propose
 * — so there is no fix here being taken away from anybody.
 *
 * Every cell with something in it is walked past, whatever is wrong with that
 * something:
 *
 * - **A real date, ISO or otherwise** — `2000-01-22` is what the column is for,
 *   and `02/16/1962`, `14-08-1982` and `03/04/1972` are P16's, P17's and P18's
 *   business respectively. Each of those cells holds a date; it is spelled
 *   oddly or read two ways, not missing.
 * - **A two-digit year** — `03-04-54` — is P19's, a date in the future is
 *   P20's, and an implausible age is P21's. All of them have a date in them.
 * - **A word, or a note in the wrong box** — `onbekend`, `n.v.t.`, `-`. This
 *   rule reports what the catalogue's P22 says it reports, which is an empty
 *   cell, and a cell with a word in it is not empty. The `dob` section names no
 *   rule for a date of birth that is not a date at all — `email` has P12 for
 *   that and this column has no counterpart — and stretching this rule to cover
 *   one would be two findings under one id (1.1.4) and a rule wider than its
 *   catalogue entry. If that column wants such a rule it is a new entry with
 *   its own sentence, not this one quietly grown.
 *
 * The column is only read, and only this one. An empty `email` is P15's
 * finding, an empty `phone` P36's and an empty `signup_date` P63's — this rule
 * tests `dob` and reports against `dob` (1.1.5), which is also what makes it
 * self-terminating: the human writes the date into the column the rule read,
 * and the row stops matching.
 */

/**
 * True when the cell holds no date: absent, empty, or nothing but whitespace.
 *
 * Trimming is what folds the three cases into one. A tab and a run of spaces
 * are as empty as `''` to the human who opens the row and to every rule in this
 * column that tries to read a date out of it, and a rule that reported the one
 * and not the other would leave a row with no date of birth and no rule.
 */
function isMissing(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const p22: CatalogueRule = {
  ruleId: 'P22',
  version: 1,
  ruleName: 'Patient date of birth is empty',
  description:
    'This patient row has no date of birth — the column is empty, or holds nothing but ' +
    'whitespace. Nothing else in the row says when this person was born: a name, an email ' +
    'address or a city identifies someone without dating their birth, and the signup date ' +
    'records when the row was created, not when the patient was born. So this row cannot ' +
    'be checked against the age the service treats patients from, and it cannot be matched ' +
    'by name and date of birth to the same person who signed up twice. The date has to ' +
    'come from a human or from a source outside this export, written year-month-day.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every row with no
   * date of birth (1.1.14). Tests `dob` and reports against `dob` (1.1.5), so a
   * row whose human has written the date of birth they checked stops matching
   * the next time the rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.dob;

      // A cell with any content in it is this rule's business no further. A
      // US-style date is P16's fix and a European one P17's, a two-way date is
      // P18's finding, a two-digit year P19's, a future date P20's and an
      // implausible age P21's — each its own rule and its own approval (1.1.4).
      // A word in the column is nobody's, and this rule does not adopt it.
      if (!isMissing(previous)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `dob`, so the id
        // is only the address of the row — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'dob',
        // Reported verbatim, so an absent date, an empty one and a cell with
        // three spaces in it stay distinguishable to the human reading the row
        // rather than all three being shown as the same nothing.
        prev: previous,
        // No value is proposed, and none can be (1.1.12).
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
