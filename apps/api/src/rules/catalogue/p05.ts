import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P05 — a patient's `full_name` written surname first, `"Berg, Jan van der"`.
 *
 * A name typed for a filing cabinet is not a name a human reads. `"Berg, Jan
 * van der"` and `"Jan van der Berg"` are the same person, but only one of them
 * is what goes on a screen, in a letter, or in the greeting of an email — and
 * only one of them sorts and compares like every other name in the column. The
 * comma is also what makes this safe to fix: the person who typed it said which
 * half is the surname, so restoring reading order guesses nothing.
 *
 * Not ambiguous: the comma marks the split, so the two halves swap and the
 * catalogue's `"Jan van der Berg"` is the only reading of them.
 *
 * Order only, and nothing else. The name it proposes may still be shouted in
 * capitals (P04), still carry `Dhr.` in front of it (P06), still be padded or
 * doubly spaced (P03) — those are their own rules and their own approvals
 * (1.1.4). The one piece of spacing this rule does take is the spacing that sat
 * against the comma, because removing the comma removes the gap it opened;
 * everything else about the value's whitespace is handed back exactly as it
 * came in, so P03 still has its finding to make on the same row.
 */

/** The value's leading whitespace, and its trailing whitespace. P03's, not ours. */
const LEADING_WHITESPACE = /^\s*/;
const TRAILING_WHITESPACE = /\s*$/;

/**
 * The two halves of a comma-inverted name, or null when the value is not one.
 *
 * Exactly one comma, with something on each side of it. That is the whole test,
 * and it is deliberately structural: a second comma — `"Smith, John, Jr."` —
 * means the value says more than "surname first" and there is no single swap
 * that undoes it, and a comma with nothing on one side of it — `"Berg,"` — is
 * not an inversion at all but a stray character, which is not what this rule
 * was written to find.
 *
 * Nothing here asks whether the halves look like names. A cell in the name
 * column that holds something else entirely is P07's finding, exactly as it is
 * for P04, and answering that question here would be a second rule (1.1.4).
 */
function invertedHalves(core: string): { surname: string; given: string } | null {
  const comma = core.indexOf(',');

  if (comma === -1 || comma !== core.lastIndexOf(',')) {
    return null;
  }

  // The whitespace taken here is only the whitespace that touched the comma:
  // the core has already had the value's own padding held back for P03.
  const surname = core.slice(0, comma).trimEnd();
  const given = core.slice(comma + 1).trimStart();

  if (surname.length === 0 || given.length === 0) {
    return null;
  }

  return { surname, given };
}

/**
 * The name in reading order, or null when the value is not comma-inverted.
 *
 * Given names first, then the surname, joined by one space — `"Berg, Jan van
 * der"` becomes `"Jan van der Berg"`, particles and all, because everything
 * after the comma moves as one piece and so does everything before it.
 *
 * The value's own leading and trailing whitespace goes back on afterwards, so
 * `"  Berg, Jan  "` comes back as `"  Jan Berg  "`. Padding is P03's fix and
 * P03's approval, and this rule leaves that row still waiting for it.
 */
function readingOrder(value: string): string | null {
  const leading = LEADING_WHITESPACE.exec(value)?.[0] ?? '';
  const trailing = TRAILING_WHITESPACE.exec(value)?.[0] ?? '';

  // A value that is nothing but whitespace matches both patterns over the whole
  // string; there is no core between them, and no comma in it either way.
  const core = value.slice(leading.length, value.length - trailing.length);
  const halves = invertedHalves(core);

  if (halves === null) {
    return null;
  }

  return `${leading}${halves.given} ${halves.surname}${trailing}`;
}

export const p05: CatalogueRule = {
  ruleId: 'P05',
  version: 1,
  ruleName: 'Patient name is written surname first',
  description:
    "The patient's name is comma-inverted — the surname first, a comma, then the given " +
    'names, as in "Berg, Jan van der". The name in reading order is proposed — what ' +
    'follows the comma, then what precedes it, joined by one space with the comma ' +
    'removed, and the rest of the name left exactly as it is.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every name that would
   * change (1.1.14). Tests `full_name` and changes `full_name` (1.1.5), so an
   * approved row stops matching the next time the rules run — the proposal has
   * no comma left in it, and a name with no comma is not a name this rule
   * matches.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.fullName;

      // The column holds nothing at all. An absent name is P08's finding, and
      // there is no order here to restore (1.1.4).
      if (previous === null) {
        continue;
      }

      const next = readingOrder(previous);

      // Not comma-inverted: no comma, more than one, or nothing on a side of
      // it. Whatever else may be wrong with this name belongs to another rule.
      if (next === null) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `full_name`, so
        // the id is only the address — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'full_name',
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
