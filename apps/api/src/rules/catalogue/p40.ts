import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P40 — a patient row with no `city` at all: the column absent, the cell empty,
 * or the cell holding nothing but whitespace.
 *
 * The export notes say one word about this column: *self-reported*. A box the
 * patient filled in themselves, on a form nobody checked, is a box that gets
 * left alone — the question was optional, the patient skipped it, the person
 * typing the row in did not have it to hand. Nothing rejected the row for being
 * blank, so the blank is what was stored.
 *
 * What it costs is small per row and only shows up in aggregate. A town is not
 * how anybody is contacted or identified — `email` and `phone` do the first,
 * `full_name`, `dob` and `bsn` the second — so an empty city breaks no
 * individual case. It breaks the counting. Anything that asks where the
 * patients are, which regions a clinic draws from, or where the next one should
 * open, is answering from the rows that happen to have a town in them, and a
 * blank is invisible in that answer rather than visibly missing from it.
 *
 * An empty cell is the honest version of what P39 reports. That rule finds a
 * cell claiming to hold a town and holding a postcode or a whole address
 * instead; this one finds a cell claiming nothing. The finding is the same
 * absent town, and the sentence a human reads about it is different, which is
 * why it is a rule of its own (1.1.4). Without it an empty city would have no
 * rule at all: P37 and P38 are both written about a value — spacing and casing
 * to clean, an alias to resolve — and all three of them step over a cell that
 * has none.
 *
 * Ambiguous, and nothing could make it otherwise:
 *
 * - **The town is nowhere else in the row.** There is no address column to read
 *   it out of, and no postcode column either. `full_name`, `dob`, `bsn` and
 *   `email` say who somebody is and not where they live, and reaching for any
 *   of them would break 1.1.5, which is what stops a rule reading one column and
 *   writing another.
 * - **A phone number is not an address, even when it looks like one.** A Dutch
 *   area code narrows a landline to a region, most of these numbers are mobile
 *   `06` numbers that narrow nothing, numbers are portable and people move.
 *   Turning `020` into `Amsterdam` would be a guess dressed as a derivation —
 *   and it would be this rule writing `city` from `phone`, which 1.1.5 forbids
 *   outright.
 * - **A town invented to fill the cell files the patient in a place they do not
 *   live.** This is the harm P39 refuses from its own side, arrived at here from
 *   the emptiest one: the commonest town in the export, or the town of the
 *   nearest clinic, would be the right shape and would be wrong, and it would be
 *   counted in every report that asks where the patients are.
 * - **The blank may be the truthful answer.** Self-reported means some of these
 *   people declined to say, and the resolution for those rows is to record that
 *   the question was put and leave the column as it stands — not a value this
 *   rule could propose either, and not a judgement it can make.
 *
 * So this rule reports and proposes nothing (1.1.12), and its description is the
 * whole of what the human reads. What resolves the row is a person who can find
 * the town — from the intake, the correspondence address, or by asking the
 * patient — and writing it in, or deciding the blank is correct and declining
 * the finding.
 *
 * Three ways a cell arrives with no town in it, and all three are this rule's:
 *
 * - `null`, because `city` is nullable and a row whose source had no such column
 *   lands that way.
 * - `''`, an empty cell in `patients.csv`.
 * - whitespace only, a cell somebody typed a space or a tab into.
 *
 * The last one is a handoff and not this rule widening itself. P37 cleans the
 * spacing and casing it names and then stops short of the cell that was *only*
 * spacing — `"   "` cleans away to nothing, and proposing an empty city would be
 * proposing the very state this rule asks a human about. P38 matches an alias as
 * the whole cell and a blank is no alias; P39 tests for a digit and a blank has
 * none. One of the four rules on this column has to own a cell of three spaces,
 * and it is this one, because to everybody who opens the row that cell is blank.
 *
 * Every cell with something in it is walked past here, whatever is wrong with
 * that something, and whose it is:
 *
 * - **A town written in letters**, however badly. `"Zwolle"` is simply right,
 *   `"  amsterdam "` is P37's clean, `"A'dam"` and `"Den Bosch"` are P38's
 *   aliases. Each of them names a place; none of them is missing one.
 * - **A postcode or a whole address** — P39's finding. `"1012 AB"` and
 *   `"Kerkstraat 12, Amsterdam"` are the wrong thing in the column rather than
 *   nothing in it, and P39's sentence about that is the true one: there is an
 *   address in the cell for a human to read the town out of.
 * - **A word that means there is no town** — `"onbekend"`, `"n.v.t."`. These say
 *   in letters what a blank says by being blank, and they are still text in the
 *   cell. Sweeping them in here would be this rule deciding on its own which
 *   words mean nothing — a guess, in every language the form was filled in —
 *   and it would put two findings under one id (1.1.4).
 * - **A mark somebody typed instead of a town** — `"-"`, `"?"`. These look like
 *   nothing to a reader and they are somebody declining to answer, but they are
 *   characters in the cell, and this rule reports an absence rather than reading
 *   what a mark was meant to mean.
 *
 * The column is only read, and only this one. An empty `email` is P15's finding,
 * an empty `sex` P25's and an empty `phone` P36's — this rule tests `city` and
 * reports against `city` (1.1.5), which is also what makes it self-terminating:
 * the human writes the town they found into the column the rule read, and the
 * row stops matching.
 */

/**
 * True when the cell holds no town: absent, empty, or nothing but whitespace.
 *
 * Trimming is what folds the three cases into one. A tab, a run of spaces and a
 * non-breaking space are as empty as `''` to the human who opens the row and to
 * anything counting patients by town, and every other rule on this column has
 * already stepped over all three — a rule that reported the one and not the
 * other would leave a blank-looking city with no rule at all.
 */
function isMissing(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export const p40: CatalogueRule = {
  ruleId: 'P40',
  version: 1,
  ruleName: 'Patient city is empty',
  description:
    'This patient row has no city — the column is empty, or holds nothing but whitespace. ' +
    'The town was self-reported on a form that never insisted on it, so a question that ' +
    'was skipped, declined, or never carried across into the export simply left the cell ' +
    'blank. Nobody is harder to reach for it, but every count of where the patients live ' +
    'is now answered from the rows that happen to have a town in them, and this row is ' +
    'invisible in that answer rather than visibly missing from it. The town is nowhere ' +
    'else in the row either: there is no address column and no postcode column, and a ' +
    'name, a date of birth and a citizen number say who someone is, not where they live. ' +
    'Nothing is proposed, because a town invented to fill the cell would be the right ' +
    'shape and would be wrong — it would file this patient in a place they do not live ' +
    'and be counted there in every report. A human finds the real town, from the intake, ' +
    'the correspondence address or the patient, and writes it in; or decides this person ' +
    'never gave one and leaves the cell as it is.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every row with no city
   * in it (1.1.14). Tests `city` and reports against `city` (1.1.5), so a row
   * whose human has written the town they found stops matching the next time the
   * rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.city;

      // A cell with any content in it is this rule's business no further.
      // Spacing and casing are P37's fix, an alias is P38's, and a postcode or a
      // whole address is P39's finding — each its own rule and its own approval
      // (1.1.4). A word meaning "there is none" and a mark typed instead of a
      // town are characters in the cell, not an absence, so they are not swept
      // in here either.
      if (!isMissing(previous)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `city`, so the id
        // is only the address of the row — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'city',
        // Reported verbatim, so an absent town, an empty cell and a cell with
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
