import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P04 — a patient's `full_name` shouted in capitals, or typed all in lower case.
 *
 * A name is what a human reads on every screen, and `"JAN DE VRIES"` and
 * `"jan de vries"` are the same person typed by someone whose caps lock was on
 * and someone who never reached for the shift key. Case is also the one defect
 * in a name that carries no information about who the person is: restoring it
 * loses no reading of the row, which is what lets this rule propose a value
 * rather than ask a human.
 *
 * Not ambiguous: a name with no case left in it has one sensible reading, and
 * the catalogue names it — title case, with the Dutch particles kept lower.
 *
 * Case only, and nothing else. The name it proposes may still be comma-inverted
 * (P05), still carry `Dhr.` in front of it (P06), still be a single token with
 * no surname (P09) — those are their own rules and their own approvals (1.1.4).
 * It does not touch spacing either: `"JAN  DE VRIES"` comes back as
 * `"Jan  de Vries"`, doubled space and all, because collapsing that is P03's
 * fix and taking it here would be two fixes in one rule.
 */

/**
 * The Dutch particles that stay in lower case inside a name.
 *
 * A fixed list, like P11's provider typos and P38's city aliases: the rule
 * recognises what is on the list and capitalises everything else, so a surname
 * it has never seen is never quietly lower-cased. `van`, `de`, `der` and `ten`
 * are the four the catalogue names; `den` is here because `van den Berg` runs
 * through this export 53 times and `Van Den Berg` would be a visibly wrong
 * proposal for exactly the names this rule is about, and `ter` because it is
 * `ten` with the other case ending and the pair is never split in practice.
 *
 * Lower case throughout, because tokens are looked up lower-cased.
 */
const DUTCH_PARTICLES: ReadonlySet<string> = new Set(['van', 'de', 'den', 'der', 'ten', 'ter']);

/** A run of non-whitespace: one token of the name, separators left where they are. */
const TOKEN = /\S+/g;

/**
 * The first letter of a token, and any letter directly after a hyphen or an
 * apostrophe.
 *
 * `Anne-Marie` and `O'Brien` are one token each and carry two capitals, so the
 * boundary inside them counts as much as the start does. The leading
 * `[^\p{L}]*` lets a token that opens with punctuation still have its first
 * real letter raised.
 */
const CAPITAL_POSITION = /(^[^\p{L}]*|[-'’])(\p{L})/gu;

/**
 * True when the value is written entirely in capitals, or entirely in lower
 * case — and false when it is neither, or has no letters to case at all.
 *
 * Asking whether changing case changes the string is what makes this work on
 * accented letters as well as plain ones: `"JOSÉ"` uppercases to itself and
 * lowercases to something else, so it has capitals and no lower case. A name
 * with both — `"Jan de Vries"`, or the half-shouted `"JAN de Vries"` — fails
 * the test, because the catalogue says *entirely* one or the other, and a name
 * that already carries case is not a name whose case was lost. A value with no
 * cased letters in it at all, `"12345"`, fails it too: there is nothing here to
 * title-case, and what that value is doing in a name column is P07's question.
 */
function isSingleCased(value: string): boolean {
  const hasLowerCase = value !== value.toUpperCase();
  const hasUpperCase = value !== value.toLowerCase();

  return hasLowerCase !== hasUpperCase;
}

/** One token, lower-cased, with its opening letters raised again. */
function capitalised(token: string): string {
  return token
    .toLowerCase()
    .replace(
      CAPITAL_POSITION,
      (_match, before: string, letter: string) => before + letter.toUpperCase(),
    );
}

/**
 * Title case across the whole value, particles kept down.
 *
 * Rewrites token by token through `replace`, so whatever separated the tokens —
 * one space, three spaces, a tab — is handed back untouched, and so are any ends
 * that were padded. This rule changes case and only case (1.1.4).
 *
 * A particle in first position is capitalised anyway: `"de vries, jan"` becomes
 * `"De Vries, Jan"`, which is how Dutch writes a surname that no given name
 * precedes. Everywhere else a particle stays down, which is the whole of what
 * "preserving Dutch particles" asks for.
 */
function titleCased(value: string): string {
  let index = 0;

  return value.replace(TOKEN, (token) => {
    const isParticle = index > 0 && DUTCH_PARTICLES.has(token.toLowerCase());
    index += 1;

    return isParticle ? token.toLowerCase() : capitalised(token);
  });
}

export const p04: CatalogueRule = {
  ruleId: 'P04',
  version: 1,
  ruleName: 'Patient name is all capitals or all lower case',
  description:
    "The patient's name is written entirely in capitals, or entirely in lower case. The " +
    'name in title case is proposed — each word given a capital, with the Dutch particles ' +
    'van, de, den, der, ten and ter left in lower case, and the spacing of the name left ' +
    'exactly as it is.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every name that would
   * change (1.1.14). Tests `full_name` and changes `full_name` (1.1.5), so an
   * approved row stops matching the next time the rules run — the proposal
   * carries both cases, and a name that carries both is not a name this rule
   * matches.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.fullName;

      // The column holds nothing at all. An absent name is P08's finding, and
      // there is no case here to restore (1.1.4).
      if (previous === null) {
        continue;
      }

      // Mixed case, or no letters at all. Either way the catalogue's "entirely
      // in capitals or entirely in lower case" does not describe this row.
      if (!isSingleCased(previous)) {
        continue;
      }

      const next = titleCased(previous);

      // Nothing to propose when title case gives the name back unchanged — a
      // single initial, say, which is already the capital it would be given.
      if (next === previous) {
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
