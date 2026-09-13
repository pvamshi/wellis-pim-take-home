import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P06 — a patient's `full_name` carrying a title or salutation, `"Dhr. Jan van
 * der Berg"`.
 *
 * A salutation is how you address someone, not part of their name. It came in
 * because the source form asked for one and whoever filled it in typed it into
 * the name box, and it stays wrong everywhere afterwards: the name sorts under
 * `D` for every man in the export, a letter opens `"Beste Dhr. Dhr. Jan"`, and
 * two rows for the same person stop matching each other because one of them
 * carries `Mevr.` and the other does not.
 *
 * Not ambiguous: the catalogue proposes "the name without it", and removing a
 * word that was never part of the name loses nothing about who the row is. The
 * safety is in the list — a fixed, closed set of forms of address, exactly like
 * P11's provider typos and P04's particles — so a surname this rule has never
 * seen is never quietly deleted.
 *
 * The title only, and nothing else. The name it proposes may still be shouted
 * in capitals (P04), still be comma-inverted (P05), still be padded or doubly
 * spaced (P03) — those are their own rules and their own approvals (1.1.4). The
 * one piece of spacing this rule does take is the gap the title itself opened,
 * because leaving it behind would turn `"Dhr. Jan"` into `" Jan"` and make a
 * whitespace defect that P03 would then have to clean up after us.
 */

/**
 * Every form of address this rule removes, lower-cased and without its dot.
 *
 * Two small closed families, and the catalogue names two of each:
 *
 * - Salutations — `dhr`, `mevr`, `mw`, `meneer`, `mevrouw`, and the English
 *   `mr` and `mrs`/`ms`. The catalogue writes `Mr` without a dot, so the dot is
 *   optional throughout. `mrs` and `ms` are here because catching `Mr` and not
 *   its feminine counterpart would fix the men's rows and leave the women's.
 * - Academic titles — `drs`, and with it `dr`, `ir`, `ing` and `prof`, which
 *   are the rest of the Dutch set and stand in exactly the same slot in front
 *   of exactly the same names.
 *
 * Closed on purpose. `heer` is not here even though `de heer` is a salutation,
 * because `de Heer` is also a Dutch surname and this rule must never be the
 * reason a row loses one.
 */
const TITLES: ReadonlySet<string> = new Set([
  'dhr',
  'mevr',
  'mw',
  'meneer',
  'mevrouw',
  'mr',
  'mrs',
  'ms',
  'drs',
  'dr',
  'ir',
  'ing',
  'prof',
]);

/** The value's leading whitespace, and its trailing whitespace. P03's, not ours. */
const LEADING_WHITESPACE = /^\s*/;
const TRAILING_WHITESPACE = /\s*$/;

/** A token of the name, with whatever whitespace sat in front of it. */
const SEPARATED_TOKEN = /(\s*)(\S+)/g;

/** One word of the name, and the gap that attached it to the word before it. */
interface NameToken {
  /** The whitespace before this token. Empty for the first one. */
  separator: string;
  /** The run of non-whitespace itself. */
  text: string;
}

/**
 * True when a token is a form of address rather than a piece of a name.
 *
 * Case-insensitive, because a shouted `"DHR. JAN DE VRIES"` carries the same
 * salutation as a quiet one and P04 owns the shouting. The trailing dot is
 * optional, which is what the catalogue's own `Mr` alongside `Dhr.` says.
 *
 * Whole tokens only. `"Berg,Dhr. Jan"` is left alone: nothing here splits a
 * token on punctuation, because a rule that reaches inside a word is a rule
 * that can take a piece of a real name with it.
 */
function isTitle(token: string): boolean {
  return TITLES.has(token.toLowerCase().replace(/\.$/, ''));
}

/** The words of the name, each carrying the whitespace that preceded it. */
function tokenise(core: string): NameToken[] {
  const tokens: NameToken[] = [];

  for (const match of core.matchAll(SEPARATED_TOKEN)) {
    tokens.push({ separator: match[1] ?? '', text: match[2] ?? '' });
  }

  return tokens;
}

/**
 * The name with its titles taken out, or null when there is nothing to take.
 *
 * A title is dropped wherever it sits, not only in front: `"Berg, Dhr. Jan van
 * der"` is a name that is both inverted and prefixed, and P06 takes the
 * salutation out of it whether or not P05 has already put it in reading order.
 * Making the two rules independent of each other is deliberate — D3 says one
 * rule's accepted fix is not what surfaces another's finding.
 *
 * The gap dropped with a title is the one on its own side: the whitespace
 * before it, or — for a title that opens the name and so has nothing before it
 * — the whitespace after it. Every other separator in the value is handed back
 * exactly as it came in, so `"Jan  Drs. Vries"` keeps its doubled space and
 * P03 still has its finding on the same row.
 *
 * Null when no token is a title, and null again when every token is one:
 * `"Dhr."` on its own is not a name with a salutation in front of it, it is a
 * row with no name at all, and proposing the empty string would be answering
 * P08's question with a worse value than the row already holds.
 */
function withoutTitles(value: string): string | null {
  const leading = LEADING_WHITESPACE.exec(value)?.[0] ?? '';
  const trailing = TRAILING_WHITESPACE.exec(value)?.[0] ?? '';

  // A value that is nothing but whitespace matches both patterns over the whole
  // string; there is no core between them, and no token in it either way.
  const core = value.slice(leading.length, value.length - trailing.length);
  const tokens = tokenise(core);
  const kept = tokens.filter((token) => !isTitle(token.text));

  if (kept.length === tokens.length || kept.length === 0) {
    return null;
  }

  // The first surviving token loses the separator it carried, which is how the
  // gap in front of it — the one the removed title opened — goes away with it.
  const rebuilt = kept
    .map((token, index) => (index === 0 ? token.text : token.separator + token.text))
    .join('');

  return `${leading}${rebuilt}${trailing}`;
}

export const p06: CatalogueRule = {
  ruleId: 'P06',
  version: 1,
  ruleName: 'Patient name carries a title or salutation',
  description:
    "The patient's name carries a form of address that is not part of it — Dhr., Mevr., " +
    'Mr, Mrs, Drs., Dr., Ir., Ing. or Prof., with or without its dot. The name without it ' +
    'is proposed — the title removed along with the gap it opened, and the rest of the ' +
    'name left exactly as it is.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every name that would
   * change (1.1.14). Tests `full_name` and changes `full_name` (1.1.5), so an
   * approved row stops matching the next time the rules run — the proposal has
   * no title left in it, and a name with no title is not a name this rule
   * matches.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.fullName;

      // The column holds nothing at all. An absent name is P08's finding, and
      // there is no salutation here to remove (1.1.4).
      if (previous === null) {
        continue;
      }

      const next = withoutTitles(previous);

      // No title in the value, or nothing in the value but titles. Whatever
      // else may be wrong with this name belongs to another rule.
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
