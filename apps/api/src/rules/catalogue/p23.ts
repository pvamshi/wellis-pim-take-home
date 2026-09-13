import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P23 — a patient's `sex` written in a spelling this export is known to use —
 * `M`, `m`, `Male`, `man`, `V`, `F`, `vrouw`, `Female` — where that spelling is
 * not the canonical one. The proposal is the same answer, written canonically.
 *
 * The export notes say this column holds "whatever the form or the ops person
 * entered at the time", and that is exactly what it holds: two answers spelled
 * eleven ways, in two languages, across the whole file. Nothing downstream can
 * group, count or filter on a column like that — `male`, `M`, `m`, `Male` and
 * `man` are one answer and five values, and any query that asks how many men
 * are in the register gets five partial answers instead of one. The information
 * is already there and correct in every one of those rows; only the spelling
 * is.
 *
 * Not ambiguous, and for the same reason P11 is not: the list. Each spelling
 * below says one thing and only one thing — `man` and `vrouw` are the Dutch
 * words, `male` and `female` the English ones, `M`, `V` and `F` their ordinary
 * abbreviations — so reading one is a lookup, not a judgement about what
 * somebody probably meant. The rule never measures how close a value is to a
 * recognised one, never reads part of a cell, and never leans on the row's
 * `full_name`, `source` or anything else to break a tie. A cell either is one
 * of the spellings, whole, or it is left alone.
 *
 * **The canonical pair is `M` and `F`, and this rule is where that is decided.**
 * The catalogue entry says "the canonical value" without naming it, so the
 * choice is made here and written down rather than left implicit in a regular
 * expression:
 *
 * - Both are already in the export, so the column is being narrowed to two of
 *   its own values rather than to a form nobody ever typed.
 * - `M` is the same letter for the Dutch `man` and the English `male`, so the
 *   male code costs no choice between the two languages the file mixes.
 * - The female side is where the languages disagree — `V` for `vrouw`, `F` for
 *   `female` — and taking `F` keeps the pair in one alphabet. `M` with `V` is a
 *   pair that reads as half Dutch and half English, and a reader who sees `V`
 *   without knowing the file is Dutch has to be told what it means.
 * - One letter each is the form a clinical record stores this field in, and it
 *   is the form the whole column can be checked against at a glance once the
 *   rule's proposals are approved.
 *
 * If the schema these rows are eventually promoted into names a different pair,
 * that is a new version of this rule (1.1.1) restating the canonical value, not
 * an edit here — the rows this version already fixed keep the decision this
 * version made, and the modification log says which version made it.
 *
 * What it takes, and what it leaves:
 *
 * - **Case and padding are forms of the same spelling.** `Male`, `male` and
 *   `MALE` are one word shouted three ways, and `  M  ` is `M` with the
 *   spreadsheet's whitespace still on it. The catalogue says "in any form", and
 *   this column has no whitespace rule and no case rule of its own the way
 *   `full_name` has P03 and P04 — so a padded or shouted spelling that this
 *   rule walked past would have no rule at all. The whole cell is replaced,
 *   padding included, because the fix is the answer rewritten rather than a
 *   piece of the old spelling edited.
 * - **The whole cell, never part of it.** The match is on the entire trimmed
 *   value, so `woman` is not read as `man` and `female` is not read as `male`.
 *   A rule that looked inside cells would propose `M` for a woman, which is the
 *   worst thing this rule could do.
 * - **Already canonical is walked past.** `M` and `F` are what this rule
 *   produces, so a row holding one has nothing to propose: a finding whose
 *   `next` equalled its `prev` would be a no-op put in front of a human, and it
 *   would never stop matching. Walking past them is also what makes the rule
 *   self-terminating — an approved row now holds `M` or `F` and does not match
 *   the next time the rules run (1.1.5).
 * - **Nothing outside the list.** `mannelijk`, `woman`, `other`, `X`, `1`, `0`,
 *   `M/F` and `onbekend` are not spellings this rule knows. Some of them plainly
 *   mean something and some plainly mean nothing, and telling those apart is
 *   P24's job — it reports the cell whole and asks a human, which is the honest
 *   answer for a value nobody recognises. Guessing at one here would make an
 *   unambiguous rule ambiguous in its most dangerous row.
 * - **An empty cell is P25's.** No spelling, nothing to canonicalise; a cell of
 *   spaces trims to nothing and falls out of the list the same way.
 *
 * The column is read and the same column is proposed against (1.1.5). A `sex`
 * written into `full_name` is not this rule's business, and `legacy_id` is only
 * how the row is addressed — its own defects are P01's and P02's.
 */

/**
 * Every spelling this rule recognises, lower-cased, and the canonical value it
 * stands for. The key is the whole trimmed cell folded to lower case, which is
 * what makes `M`, `m`, `Male`, `male` and `MALE` four keys' worth of spelling
 * and two entries' worth of table.
 *
 * The eight the catalogue names, and nothing else. Each entry is a claim that
 * some string means one sex and cannot mean the other, and that claim is only
 * safe for words somebody has actually seen in this column. Adding `mannelijk`,
 * `woman`, `1` or `2` here on a guess would be this rule quietly deciding a
 * value P24 exists to ask a human about — and widening the list is a new
 * version of the rule (1.1.1), written by somebody who has seen the values.
 */
const CANONICAL_SPELLINGS = new Map<string, string>([
  // Male: the English word, the Dutch word, and the letter both share.
  ['m', 'M'],
  ['male', 'M'],
  ['man', 'M'],

  // Female: the English word and its letter, the Dutch word and its letter.
  ['f', 'F'],
  ['female', 'F'],
  ['v', 'F'],
  ['vrouw', 'F'],
]);

export const p23: CatalogueRule = {
  ruleId: 'P23',
  version: 1,
  ruleName: 'Patient sex is a recognised spelling that is not the canonical one',
  description:
    "This patient's sex is written in one of the spellings the old system collected — M, " +
    'm, male, Male or man for a man, F, f, V, female, Female or vrouw for a woman — ' +
    'rather than in the one form the column is meant to hold. The same answer written ' +
    'canonically is proposed: M for male, F for female. Reading it is not a judgement — ' +
    'each of those spellings says one thing and only one thing, in Dutch or in English — ' +
    'so the answer in the row is kept exactly as it was given and only its spelling ' +
    'changes. A value nobody recognises is not touched here, and nothing is guessed.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every recognised
   * spelling that is not already canonical, rewritten (1.1.14). Tests `sex` and
   * changes `sex` (1.1.5), and what it proposes is `M` or `F`, so an approved
   * row stops matching the next time the rules run.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.sex;

      // No value in the column at all, which is P25's finding. There is no
      // spelling here to canonicalise.
      if (previous === null) {
        continue;
      }

      // The whole cell, trimmed and folded, looked up once. An empty cell and a
      // cell of spaces both trim to nothing and miss the table, which leaves
      // them to P25; anything else that misses it is a value nobody recognises,
      // which is P24's finding and reported there whole rather than guessed at
      // here.
      const canonical = CANONICAL_SPELLINGS.get(previous.trim().toLowerCase());

      if (canonical === undefined) {
        continue;
      }

      // Already exactly what this rule produces. Proposing `M` in place of `M`
      // would put a change with nothing in it in front of a human, and the row
      // would match again on every run — this is the guard that makes the rule
      // self-terminating once its proposal is applied.
      if (canonical === previous) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `sex`, so the id
        // is only the address of the row — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'sex',
        // Reported exactly as stored, padding and capitals and all, so a human
        // comparing the two sees the cell they would see in the row.
        prev: previous,
        // The canonical value for the answer the cell already gave. The whole
        // cell is replaced, which is why any padding around the spelling goes
        // with the spelling it belonged to.
        next: canonical,
      });
    }

    return { ambiguity: false, updates };
  },
};
