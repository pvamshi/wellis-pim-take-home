import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P24 — a patient's `sex` holding a value that is none of the spellings this
 * export is known to use: not `M`, `m`, `Male`, `male`, `man`, and not `F`,
 * `f`, `V`, `Female`, `female`, `vrouw`, in any capitals and with any padding.
 *
 * The export notes say this column holds "whatever the form or the ops person
 * entered at the time". P23 is the half of that sentence which turned out well:
 * eleven spellings of two answers, each of which says one thing and only one
 * thing, so reading it is a lookup. This rule is the other half — the cell that
 * came out of a free-text box holding something nobody can look up. `onbekend`,
 * `X`, `other`, `1`, `M/F`, `mannelijk`, a dash, a whole sentence: all of them
 * are a `sex` column with something in it that the register cannot read.
 *
 * It is a rule of its own and not a branch of P23 (1.1.4) because it is a
 * different finding with a different answer. P23's sentence to a human is "this
 * is the same answer, spelled differently, and here is the canonical spelling".
 * This one's is "something is in this cell and nobody here knows what it means".
 * The first is approved by glancing at it; the second is resolved by a person
 * going and finding out.
 *
 * Ambiguous, and this is the row where guessing does the most damage:
 *
 * - **An unrecognised value is not a near miss.** The obvious temptation is to
 *   measure how close the cell is to a spelling that is recognised and propose
 *   the nearest — `mannelijk` starts with `man`, `M.` is `M` with a stop,
 *   `woman` contains `man`. Every one of those is a guess about what somebody
 *   meant, and one of them is wrong in the worst possible direction: `woman`
 *   read as `man` writes the opposite sex onto a patient record. A rule that
 *   proposes here would be confidently wrong on exactly the rows that need a
 *   human.
 * - **Some of these cells mean nothing at all.** `X`, `-`, `n.v.t.` and `?` are
 *   somebody declining to answer, or a form's own filler. The right resolution
 *   for those may be to empty the column rather than to fill it, and that is not
 *   a value this rule could propose either.
 * - **Some of them mean something this column cannot hold.** `non-binary`,
 *   `intersex` and `other` are answers a person gave. Whether the register
 *   records them, and as what, is a decision about what the column is for — a
 *   schema question for a human, not a rewrite a rule may make on its own.
 * - **Nothing else in the row settles it.** `full_name` suggests a sex without
 *   stating one and is wrong often enough to be useless — names are shared
 *   across sexes, shortened, and typed by hand (P03 through P09 exist because
 *   this column is a mess of its own). Leaning on it would also break 1.1.5,
 *   which is what stops a rule reading one column and writing another.
 *
 * So this rule reports and proposes nothing (1.1.12), and its description is the
 * whole of what the human reads. What resolves the row is a person who knows
 * what the value meant — from the intake, the consent log, or by asking the
 * patient — writing `M` or `F` in, or clearing the cell if the answer was never
 * given.
 *
 * What it takes, and what it leaves:
 *
 * - **The recognised spellings are walked past, in any form.** `Male`,
 *   `  male  ` and `MALE` are recognised, so they are P23's finding and not
 *   this one's. The cell is trimmed and folded to lower case before it is
 *   looked up, for exactly the reason P23 does it: a padded or shouted spelling
 *   is the same spelling, and a row that both rules matched would put two
 *   findings in front of a human for one problem (1.1.4).
 * - **`M` and `F` are recognised too.** They are the canonical pair P23 writes,
 *   and a column already holding what the register wants is not a problem to
 *   report.
 * - **The whole cell, never part of it.** The lookup is on the entire trimmed
 *   value, so `mannelijk` misses and is reported here whole. Reading the front
 *   of a cell would be this rule quietly doing what it just said it must not.
 * - **An empty cell is P25's.** No value, nothing nobody recognises; a cell of
 *   spaces trims to nothing and goes the same way. The sentence for a row with
 *   nothing in this column is "this was never answered", which is a different
 *   sentence from "this was answered with something unreadable", and it is P25
 *   that says it.
 *
 * The column is only read, and only this one. A sex written into `full_name` is
 * P07's business, an unrecognised `status` or `weight_unit` belongs to its own
 * column's rules, and `legacy_id` is only how the row is addressed — its own
 * defects are P01's and P02's. This rule tests `sex` and reports against `sex`
 * (1.1.5), which is also what makes it self-terminating: the human writes a
 * recognised value into the column the rule read, and the row stops matching.
 */

/**
 * Every spelling of a sex this export is known to use, lower-cased. A cell that
 * folds to one of these is recognised and is not this rule's finding.
 *
 * The same eight keys P23 v1 canonicalises, written out here rather than
 * imported from it. Each rule file is one version of one rule, frozen (1.1.1):
 * if a later version of P23 learns a spelling, P24 v1 must go on reporting that
 * spelling as unrecognised until somebody writes P24 v2 that agrees — the rows
 * already decided by these two versions keep the decision they were given, and
 * the modification log names the version that made it. A shared list would
 * change this rule's behaviour without a new version of it and without a diff
 * in this file, which is the one thing the version key exists to prevent.
 */
const RECOGNISED_SPELLINGS = new Set([
  // Male: the English word, the Dutch word, and the letter both share.
  'm',
  'male',
  'man',

  // Female: the English word and its letter, the Dutch word and its letter.
  'f',
  'female',
  'v',
  'vrouw',
]);

export const p24: CatalogueRule = {
  ruleId: 'P24',
  version: 1,
  ruleName: 'Patient sex is a value nobody recognises',
  description:
    "This patient's sex is a value the register cannot read. The old system took this " +
    'column as free text, and the spellings it is known to use — M, m, male, Male or man ' +
    'for a man, F, f, V, female, Female or vrouw for a woman — are made canonical by ' +
    'another rule. This cell is none of them, and nothing in the row says what it was ' +
    'meant to be: it may be a word in another language, a code from some other system, an ' +
    'answer this column was never designed to hold, or somebody declining to answer at ' +
    'all. Nothing is proposed, because the only way to propose one would be to guess which ' +
    'recognised value it most resembles, and that guess writes a sex onto a patient record ' +
    'that the patient never gave. The cell is shown exactly as it stands: a human decides ' +
    'what it means and writes M or F in, or clears it if the answer was never given.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every row whose `sex`
   * holds a value that is not a recognised spelling (1.1.14). Tests `sex` and
   * reports against `sex` (1.1.5), so a row whose human has written a
   * recognised value in stops matching the next time the rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.sex;

      // No value in the column at all, which is P25's finding. There is nothing
      // here for anybody to fail to recognise.
      if (previous === null) {
        continue;
      }

      const spelling = previous.trim().toLowerCase();

      // A cell of nothing but whitespace trims away to the same nothing an
      // empty cell holds, and goes to P25 with it. A rule that reported one and
      // not the other would split a single finding across two sentences.
      if (spelling.length === 0) {
        continue;
      }

      // A spelling this export is known to use, whatever its capitals and
      // padding. Either it is already canonical or P23 proposes the canonical
      // form for it; either way this rule has nothing to say about the row.
      if (RECOGNISED_SPELLINGS.has(spelling)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `sex`, so the id
        // is only the address of the row — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'sex',
        // Reported verbatim, padding and capitals and all. The human's whole
        // job here is to work out what the cell was meant to say, so they are
        // shown the cell as it is rather than a tidied version of it.
        prev: previous,
        // No value is proposed, and none can be (1.1.12).
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
