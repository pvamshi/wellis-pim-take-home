import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P42 — a patient's `weight` with the unit typed into the value: `82 kg`,
 * `180lbs`. The proposal is the number alone.
 *
 * The export notes say the unit column was "added later and backfilled where
 * obvious", and added later is the whole of the story. Before `weight_unit`
 * existed there was one box on the form, and the only way to say what the
 * number meant was to write it after the number — so some people wrote it.
 * Then the column arrived, the backfill reached the rows where the unit was
 * obvious, and a row whose unit was obvious only because it was sitting inside
 * the value is exactly the row that backfill was least likely to reach.
 *
 * What it costs is that the column stops being numeric. A weight is only ever
 * read as a number — compared against a threshold, averaged, charted, sorted —
 * and `82 kg` is a string that no strict reader parses at all. The forgiving
 * readers do worse than fail: they read the leading digits and drop the rest,
 * so `82 kg` and `180lbs` arrive at whatever is downstream as 82 and 180 with
 * nothing left to say that the second one was never in kilograms. The unit is
 * only informative while a human is looking at the cell, and every machine that
 * reads the column afterwards has already thrown it away.
 *
 * Not ambiguous. The number is already in the cell, written by the person who
 * reported it; this rule does not compute it, round it or convert it, and the
 * digits it proposes are the digits that were there. Removing a unit takes
 * nothing away from the number it was attached to, so there is nothing here for
 * a human to decide (1.1.12). The safety is in the list — a closed set of unit
 * spellings, the same device as P06's titles, P11's provider typos and P38's
 * city aliases — so a cell ending in a word this rule has never seen is never
 * quietly truncated to its leading digits.
 *
 * **The unit comes off the value and is not written anywhere else.** That is
 * 1.1.5: this rule tests `weight` and changes `weight`, and `weight_unit` is a
 * different column with rules of its own (P46, P47, P48). So a row whose only
 * record of being in pounds was the `lbs` in the value has, after this fix, a
 * bare number in a column the notes call "probably kilograms" — and the
 * catalogue's closing note is explicit that pounds-to-kilograms is the one
 * conversion these constraints cannot express, and that it is unsettled. This
 * rule does not settle it and does not pretend the question is not there. Two
 * things keep the fix honest in the meantime: the finding is approved by a
 * human who sees `180lbs` and `180` side by side before anything is written,
 * and the rule row is the modification log (1.3), so the cell as it was found
 * stays on the record whatever is decided about the unit later.
 *
 * Where the rule stops, and why each line is drawn there:
 *
 * - **A unit spelling that is not on the list.** `82 steen`, `82 st`, `82 x`.
 *   Nothing is stripped because it looks like a suffix; a word is removed only
 *   when it is one of ten spellings of two units. P43 reports the rest to a
 *   human, whole.
 * - **`gram`, and every other real unit that is not one of these two.** `820
 *   gram` is a weight, and removing the word would leave `820` standing in a
 *   column read as kilograms — a patient filed at eight hundred and twenty
 *   kilograms because a rule tidied a cell it had no reading for. Kilograms and
 *   pounds are on the list because they are the two units this export is in:
 *   `weight_unit` holds `kg` and `lbs` and nothing else, and the notes name the
 *   pounds campaign that put them there. A unit the unit column cannot express
 *   is not one this rule takes off the value.
 * - **A number written with a comma decimal.** `82,5 kg` is left alone, and it
 *   is P41's finding until P41's fix is approved. The proposal here is "the
 *   number alone", and `82,5` is not a number — proposing it would leave the
 *   cell exactly as unreadable as it was, and would put a second proposal on a
 *   field that already has one. Once the separator is settled the cell reads
 *   `82.5 kg` and this rule takes the unit off it on the next run. Two defects,
 *   two fixes, two approvals, one after the other (1.1.4).
 * - **Anything in the cell besides a number and a unit.** `kg 82`, `82 kg
 *   netto`, `82 kg (geschat)`, `ca. 82 kg`. Each of them holds something this
 *   rule would have to decide about — which token is the number, what the note
 *   beside it means — and a rule that proposes a value proposes it only where
 *   the cell has one reading. P43 puts these in front of a human.
 * - **A unit with no number in front of it.** `kg`, `onbekend kg`. The fix is
 *   the number alone and there is no number, and a rule whose proposal is a
 *   weight cannot propose an empty cell.
 * - **An empty cell.** P45's finding. Nothing here carries a unit.
 *
 * What it hands on, with the unit off the value:
 *
 * - **A weight nobody has.** `900 kg` becomes `900`, and 900 is still over
 *   P44's ceiling. Taking the unit out of the value says nothing about whether
 *   the number is right, and this rule claims nothing about that.
 * - **A unit column that disagrees, or is empty.** Whether `weight_unit` says
 *   `kg`, says `lbs`, or says nothing at all is never read here and changes
 *   nothing about which characters in this cell are the number. An empty unit
 *   beside a weight is P47's finding, and it is still P47's finding afterwards.
 *
 * The padding goes with the unit, the way it goes with the separators in P26
 * and the grouping in P30: `weight` has no whitespace rule of its own the way
 * `legacy_id` has P01, so a rule that lifted `kg` out of `  82 kg  ` and handed
 * back `  82  ` would leave a padded number with no rule to clean it and no
 * reason for the padding to be there. What is proposed is the number, which is
 * what the catalogue says and what the column is for.
 *
 * The column is read and the same column is proposed against (1.1.5), and the
 * proposal has no letters in it, so an approved row is walked past the next
 * time the rules run.
 *
 * No weight in the export in hand carries a unit — every value in the column is
 * a bare number today, with `kg` or `lbs` beside it in `weight_unit`, which is
 * the backfill having done its job. The rule still belongs in the catalogue:
 * the next export is written by the same form and the same ops team, a rule
 * that matches no row costs nothing, and the rules screen only shows rules with
 * something to say.
 *
 * The intake tables carry their own self-reported weight and need their own
 * rule, because a rule names the column it is about (1.1.4).
 */

/**
 * Every unit spelling this rule takes off a value, lower-cased and without a
 * trailing dot.
 *
 * Two closed families, and they are the two units the export is in:
 *
 * - **Kilograms** — `kg`, and the spellings that stand in the same slot after
 *   the same numbers: `kgs`, `kilo`, `kilos`, `kilogram`, `kilograms`. The
 *   catalogue writes `KG`, `kgs`, `kilo` and `Kilogram` as recognised forms of
 *   this unit in P46, and a unit is written the same way inside a value as
 *   beside it.
 * - **Pounds** — `lb`, `lbs`, `pound`, `pounds`. The export notes name the
 *   campaign that put them there, and `weight_unit` still holds `lbs` for the
 *   rows it reached.
 *
 * Closed on purpose, and `pond` is deliberately not here: a Dutch pond is half
 * a kilogram, not a pound, so reading it as either one would be this rule
 * deciding what a patient meant. `82 pond` goes to P43 and a human.
 */
const UNITS: ReadonlySet<string> = new Set([
  'kg',
  'kgs',
  'kilo',
  'kilos',
  'kilogram',
  'kilograms',
  'lb',
  'lbs',
  'pound',
  'pounds',
]);

/**
 * A cell holding a number and then a word, and nothing else at all.
 *
 * The number is digits with at most one dot in them, because "the number alone"
 * has to leave a number behind: a comma decimal is not one until P41 has
 * settled it. The gap between the two is optional — the catalogue's own `82 kg`
 * and `180lbs` are the same defect written with and without it — and so is a
 * dot closing the abbreviation, which is how `kg.` is written when it is
 * written out. Whitespace at either end is allowed and is not handed back: it
 * is padding around a number, and the number is what is proposed.
 *
 * Anchored at both ends, so a cell with a second word, a bracket, a sign or a
 * note in it does not match at all and is read no further.
 */
const NUMBER_THEN_UNIT = /^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)\.?\s*$/;

/**
 * The number a cell holds when the rest of the cell is one recognised unit, and
 * null for every other cell.
 *
 * Two steps, and the order is the point: the shape is matched first, so the
 * only word ever looked up is one that a number and nothing else stands in
 * front of, and the lookup is what decides whether that word is a unit. The
 * digits come back exactly as they were written — this rule does not reformat a
 * number, it only stops one from having a unit stuck to it.
 */
function numberWithoutUnit(value: string): string | null {
  const matched = NUMBER_THEN_UNIT.exec(value);

  if (matched === null) {
    return null;
  }

  const written = matched[1] ?? '';
  const unit = matched[2] ?? '';

  if (!UNITS.has(unit.toLowerCase())) {
    return null;
  }

  return written;
}

export const p42: CatalogueRule = {
  ruleId: 'P42',
  version: 1,
  ruleName: 'Patient weight has its unit written into the value',
  description:
    'The weight has the unit typed into the value — 82 kg, 180lbs — where the unit belongs ' +
    'in the weight_unit column beside it. That column was added to the export late and ' +
    'backfilled only "where obvious", so the rows that still say their unit out loud are the ' +
    'ones the backfill left behind. A weight is only ever read as a number, and this one is ' +
    'not a number: a strict reader takes nothing from it, and a forgiving one takes the ' +
    'leading digits and drops the unit on the floor — which is how a weight reported in ' +
    'pounds ends up counted as kilograms further down. The number is proposed exactly as it ' +
    'was reported, with the unit and the spacing around it removed and no digit touched. ' +
    'Only a closed list of spellings of kilograms and pounds is removed, so a cell ending in ' +
    'anything else is left whole for a human. What the number then means is a separate ' +
    'question: this rule does not write the unit column, does not convert pounds to ' +
    'kilograms, and does not judge whether the weight is plausible.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every weight whose
   * value carries its unit (1.1.14). Tests `weight` and changes `weight`
   * (1.1.5), so an approved row stops matching the next time the rules run: the
   * proposal is digits, and a cell has to end in a unit to be read at all.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.weight;

      // The column holds nothing at all. An absent weight is P45's finding, and
      // there is no unit here to take off anything (1.1.4).
      if (previous === null) {
        continue;
      }

      const next = numberWithoutUnit(previous);

      // Not a number followed by a unit this rule knows: a bare number already,
      // a comma decimal waiting on P41, a unit nobody recognises, or a cell
      // holding something else entirely. P43, P44 and P45 read those.
      if (next === null) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `weight`, so the
        // id is only the address of the row — whatever is wrong with the id
        // itself belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'weight',
        prev: previous,
        // The digits as the patient wrote them, with the unit and the
        // whitespace that carried it gone. Nothing is converted and nothing is
        // rounded: this rule settles what is in the cell, not what it means.
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
