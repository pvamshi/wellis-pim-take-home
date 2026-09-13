import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P25 — a patient row with no `sex` at all: the cell empty, or holding nothing
 * but whitespace.
 *
 * The export notes say this column holds "whatever the form or the ops person
 * entered at the time", and one of the things a form collects is nothing. The
 * other two rules on this column both read a value and say something about it —
 * P23 that it is a recognised spelling written the wrong way, P24 that it is
 * something nobody can read. This is the row where there is no value to read,
 * and that is a different sentence to put in front of a human: not "this is
 * spelled oddly" and not "this is unreadable", but "this was never answered".
 * It is a rule of its own for that reason (1.1.4), and because without it an
 * empty `sex` would have no rule at all — P23 has no spelling to canonicalise
 * here and P24 has nothing to fail to recognise, so both walk past.
 *
 * Ambiguous, and there is nothing in the export that could make it otherwise:
 *
 * - **Nothing else in the row states a sex.** `full_name` hints at one without
 *   stating it and is wrong often enough to be useless — names are shared
 *   across sexes, shortened to initials, and typed by hand (P03 through P09
 *   exist because that column is a mess of its own). `bsn` is a citizen service
 *   number and encodes nothing about the person. `email`, `city`, `phone` and
 *   `source` identify a signup without describing the patient. Leaning on any
 *   of them would also break 1.1.5, which is what stops a rule reading one
 *   column and writing another.
 * - **There is no safe default.** The column holds two answers and neither is
 *   the one to assume; picking the commoner of the two, or the one the rest of
 *   the file leans towards, writes a sex onto a patient record that the patient
 *   never gave. This is the same danger P24 refuses, arrived at from the other
 *   side: guessing at an empty cell is guessing at a person.
 * - **The blank may be the truthful answer.** Some of these rows are somebody
 *   who was never asked, or who declined to say. The resolution for those is to
 *   leave the column as it stands and record that the question was put — not a
 *   value this rule could propose either, and not a judgement it can make.
 *
 * So this rule reports and proposes nothing (1.1.12), and its description is
 * the whole of what the human reads. What resolves the row is a person who can
 * find out what the patient actually answered — from the intake, the consent
 * log, or by asking them — and writing `M` or `F` in, or deciding the blank is
 * correct and declining the finding.
 *
 * Three ways a cell arrives with no value in it, and all three are this rule's:
 *
 * - `null`, because `sex` is nullable and a row whose source had no such column
 *   lands that way.
 * - `''`, an empty cell in `patients.csv`.
 * - whitespace only, a cell somebody typed a space or a tab into.
 *
 * The last one is not this rule widening itself. P23 and P24 both fold the cell
 * to a trimmed, lower-cased spelling before they look at it, so a cell of
 * spaces falls out of both exactly as an empty one does; reporting the one and
 * not the other would split a single finding in two and leave a blank-looking
 * `sex` with no rule. There is also no whitespace rule on this column to take a
 * trim away from — padding around a real spelling is swallowed by the canonical
 * value P23 proposes, not fixed on its own.
 *
 * Every cell with something in it is walked past, whatever that something is:
 *
 * - **A recognised spelling** — `M`, `F`, `m`, `male`, `Male`, `MALE`, `man`,
 *   `V`, `vrouw`, `female` — is P23's business, or already canonical and
 *   nobody's. `  Male  ` is padded, not empty: there is an answer in that cell.
 * - **A value nobody recognises** — `onbekend`, `X`, `other`, `1`, `M/F`,
 *   `mannelijk` — is P24's. It is unreadable, which is not the same as absent,
 *   and a human resolving it is answering a different question.
 * - **A filler character** — `-`, `?`, `n.v.t.`, `0`. These look like nothing
 *   to a reader and they are somebody declining to answer, but they are
 *   characters in the cell, so P24 reports them whole and asks. A rule that
 *   swept them in here would be deciding on its own which marks mean "empty",
 *   which is a guess, and it would put two findings under one id (1.1.4).
 *
 * The column is only read, and only this one. An empty `full_name` is P08's
 * finding, an empty `email` P15's, an empty `dob` P22's and an empty `phone`
 * P36's — this rule tests `sex` and reports against `sex` (1.1.5), which is
 * also what makes it self-terminating: the human writes the answer into the
 * column the rule read, and the row stops matching.
 */

/**
 * True when the cell holds no value: absent, empty, or nothing but whitespace.
 *
 * Trimming is what folds the three cases into one. A tab and a run of spaces
 * are as empty as `''` to the human who opens the row, and to P23 and P24,
 * which both trim before they look — a rule that reported the one and not the
 * other would leave a row with no sex and no rule.
 */
function isMissing(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const p25: CatalogueRule = {
  ruleId: 'P25',
  version: 1,
  ruleName: 'Patient sex is empty',
  description:
    'This patient row has no sex — the column is empty, or holds nothing but whitespace. ' +
    'The old system took this column as free text, and a free-text box collects blanks: ' +
    'the question may never have been asked, the patient may have declined to answer, or ' +
    'the answer may simply have been lost on the way into the export. Nothing else in the ' +
    'row says what it was: a name suggests a sex without stating one and is wrong often ' +
    'enough to be useless, and no other column describes the patient at all. Nothing is ' +
    'proposed, because the only way to propose a value would be to assume one, and that ' +
    'assumption writes a sex onto a patient record that the patient never gave. A human ' +
    'finds out what was answered and writes M or F in, or decides the blank is correct and ' +
    'leaves it.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every row with no sex
   * in it (1.1.14). Tests `sex` and reports against `sex` (1.1.5), so a row
   * whose human has written the answer they found stops matching the next time
   * the rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.sex;

      // A cell with any content in it is this rule's business no further. A
      // recognised spelling is P23's fix and an unrecognised value P24's
      // finding — each its own rule and its own approval (1.1.4). A filler
      // character is P24's too: it is a character, not an absence.
      if (!isMissing(previous)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `sex`, so the id
        // is only the address of the row — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'sex',
        // Reported verbatim, so an absent value, an empty one and a cell with
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
