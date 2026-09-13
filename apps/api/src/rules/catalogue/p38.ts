import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P38 — a patient's `city` holding a known alias for a town rather than the
 * town's own name: `A'dam` for Amsterdam, `Den Bosch` for 's-Hertogenbosch,
 * `s Gravenhage` for Den Haag. The proposal is the place the alias names,
 * looked up in a fixed list.
 *
 * The export notes say this column is self-reported, and an alias is what
 * self-reporting produces once the abbreviation is common enough that nobody
 * thinks of it as one. It is not a typo and not a spelling variant: `A'dam` is
 * a second name for a place that already has 118 rows under its first name in
 * this file. Anything that groups patients by where they live counts that town
 * twice, and the second count is invisible — the alias sorts nowhere near the
 * name, so nobody reading a list of cities notices that two of the entries are
 * one town.
 *
 * Not ambiguous, and one thing makes it so: the list. `A'dam` is not a place in
 * its own right, there is exactly one town it names, and reading it is a lookup
 * rather than a judgement about what somebody probably meant. That is what the
 * catalogue means by "from a fixed list only" — the rule never measures how
 * close a value is to a city name, never reads part of a cell, and never leans
 * on any other column to break a tie. A cell either is one of the aliases,
 * whole, or it is left alone.
 *
 * **The list is the three the catalogue names, and nothing else.** Every extra
 * entry is a new claim that some string names one town and cannot name
 * anything else, and that claim goes wrong quickly. `R'dam` would be the exact
 * parallel of `A'dam` and is left off anyway, because adding it here is a guess
 * made in this file rather than a decision made by somebody who has seen an
 * export that contains it. `Adam` is left off for a harder reason: it is a
 * first name, and a rule that rewrote it would turn a misfiled person into a
 * city and be certain about it. Widening the list is a new version of this rule
 * (1.1.1), not an edit here.
 *
 * **Which name is the canonical one.** The catalogue says "the canonical city"
 * without naming it, so the choice is made here and written down:
 *
 * - **The name this column already uses, where it uses one.** `Den Haag` has
 *   123 rows in this export and `'s-Gravenhage` has none, so the Hague aliases
 *   resolve to `Den Haag`. Proposing the formal name instead would narrow the
 *   column to a spelling nobody in it ever typed, and would leave 123 correct
 *   rows looking wrong.
 * - **The town's own written name, where the column uses neither.** Neither
 *   `Den Bosch` nor `'s-Hertogenbosch` appears in this export, and `Den Bosch`
 *   is the nickname — the town is written `'s-Hertogenbosch` on its own
 *   register, so that is what the alias resolves to.
 *
 * If the schema these rows are promoted into carries its own list of place
 * names, that is a new version of this rule restating the canonical values, not
 * an edit here: rows this version already fixed keep the decision this version
 * made, and the modification log says which version made it.
 *
 * **The alias is matched however it was typed.** The cell is trimmed, its inner
 * spacing reduced, its curly apostrophes straightened and the whole thing folded
 * to lower case before the lookup, so `"  DEN  BOSCH "` is found as surely as
 * `"Den Bosch"`. P37 would tidy that same cell to `Den Bosch`, but a rule that
 * only recognised the tidy spelling would sit and wait for P37's approval before
 * it could say anything, and no rule waits on another's approval.
 *
 * **The whole cell is replaced**, padding and capitals included, because the
 * fix is the place named again rather than a piece of the old spelling edited —
 * the same reason P23 rewrites a whole `sex` cell. It is still one fix (1.1.4):
 * the cell named a town under an alias, and the proposal is that town. It also
 * means the proposal is already written the way P37 writes a city, so approving
 * this finding settles the row rather than handing it on.
 *
 * A row holding `"DEN BOSCH"` does carry both findings at once, and either order
 * of approval lands in the same place: approve this one and the cell becomes
 * `'s-Hertogenbosch`, which P37 has nothing to say about; approve P37's first
 * and the cell becomes `Den Bosch`, which this rule still catches.
 *
 * What it walks past:
 *
 * - **A city already written as itself.** No name this rule proposes is a key in
 *   the list below — `Amsterdam` normalises to `amsterdam`, which the list does
 *   not hold — and that is what makes the rule self-terminating: an approved row
 *   does not match the next time the rules run (1.1.5). It is also why this rule
 *   needs no guard against proposing a value equal to the one already there. Any
 *   future version that adds an alias whose canonical form is a key of its own
 *   has to put that guard back.
 * - **A town this rule has never heard of.** Not on the list, not touched. A
 *   cell that names no place at all is P39's finding and is reported there
 *   whole, rather than guessed at here.
 * - **An empty cell, or one of nothing but spaces.** It holds no alias; an
 *   absent city is P40's finding.
 * - **Every other column.** The column read is the column proposed against
 *   (1.1.5), and the row's `legacy_id` is only the address of the row — its own
 *   defects are P01's and P02's.
 */

/** Any run of whitespace: ordinary spaces, tabs, newlines, non-breaking spaces. */
const WHITESPACE_RUN = /\s+/g;

/** The curly apostrophes a word processor substitutes for a typed one. */
const CURLY_APOSTROPHE = /[’‘]/g;

/**
 * The cell as the lookup sees it: ends trimmed, inner spacing reduced to single
 * spaces, apostrophes straightened, and folded to lower case.
 *
 * This is a key, never a proposal. Nothing normalised here is handed back to
 * anybody — the value proposed comes out of the table below, written the way the
 * place is written.
 */
function lookupKey(value: string): string {
  return value.trim().replace(WHITESPACE_RUN, ' ').replace(CURLY_APOSTROPHE, "'").toLowerCase();
}

/**
 * The fixed list: an alias, normalised as a key, and the town it names.
 *
 * Three towns and six keys. The extra keys are not extra claims — they are the
 * one Hague alias as the four people who type it type it, with the elision
 * written or dropped and the parts joined by a hyphen or a space. Each says the
 * same thing about the same place.
 */
const CANONICAL_CITIES = new Map<string, string>([
  // Amsterdam, elided the way the city elides it.
  ["a'dam", 'Amsterdam'],

  // 's-Hertogenbosch under its nickname.
  ['den bosch', "'s-Hertogenbosch"],

  // Den Haag under its formal name, spelled four ways.
  ['s gravenhage', 'Den Haag'],
  ["'s gravenhage", 'Den Haag'],
  ['s-gravenhage', 'Den Haag'],
  ["'s-gravenhage", 'Den Haag'],
]);

export const p38: CatalogueRule = {
  ruleId: 'P38',
  version: 1,
  ruleName: 'Patient city is a known alias for the town',
  description:
    "This patient's city is a well-known alias for a town rather than the town's own " +
    "name — A'dam for Amsterdam, Den Bosch for 's-Hertogenbosch, s Gravenhage for Den " +
    'Haag. The column is self-reported, so one town arrives under two names, and anything ' +
    'that counts patients by where they live counts it twice without showing that it has. ' +
    'The town the alias names is proposed, taken from a fixed list of aliases and nothing ' +
    'else — the rule never guesses at a name it does not know, and a city it has not ' +
    'heard of is left exactly as it stands.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every alias, resolved
   * (1.1.14). Tests `city` and changes `city` (1.1.5), and what it proposes is a
   * town name rather than an alias, so an approved row stops matching the next
   * time the rules run.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.city;

      // The column holds nothing at all, so it holds no alias. An absent city is
      // P40's finding.
      if (previous === null) {
        continue;
      }

      // The whole cell, normalised and looked up once. An empty cell and a cell
      // of spaces normalise to nothing and miss the table, which leaves them to
      // P40; anything else that misses it is either a town written as itself or
      // a value this rule has never heard of, and neither is guessed at here.
      const canonical = CANONICAL_CITIES.get(lookupKey(previous));

      if (canonical === undefined) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `city`, so the id
        // is only the address of the row — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'city',
        // Reported exactly as stored, padding and capitals and all, so a human
        // comparing the two sees the cell they would see in the row.
        prev: previous,
        // The town the alias names, written the way the place is written. The
        // whole cell is replaced, which is why any padding around the alias goes
        // with the alias it belonged to.
        next: canonical,
      });
    }

    return { ambiguity: false, updates };
  },
};
