import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P37 — a patient's `city` padded at the ends, spaced out inside, or typed in
 * casing that is not the way the place is written.
 *
 * The export notes say this column is self-reported, which is the whole of the
 * problem: `"  AMSTERDAM"`, `"amsterdam"`, `"Amsterdam "` and `"AmSterdam"` are
 * one town typed by four people into a free-text box. A city is read on every
 * screen that shows the patient and grouped on by anybody counting where
 * patients live, and none of that grouping works while the same place arrives
 * under four spellings that differ only in spacing and case.
 *
 * In the export in hand this column happens to have arrived clean, so the rule
 * finds nothing today. That is not a reason to leave it unwritten: the next
 * export of a self-reported free-text field will not be, and a rule that
 * matches no row costs nothing — the rules screen only shows rules that have
 * something to say.
 *
 * Not ambiguous. Spacing and case are the two defects in a place name that
 * carry no information about which place it is: `"UTRECHT"` names Utrecht as
 * plainly as `"Utrecht"` does, so restoring the written form loses no reading of
 * the row and needs no human to choose between readings.
 *
 * **Why spacing and case are one rule here and two on `full_name`.** P03 and
 * P04 split them because a person's name has no canonical form to check
 * against — we know how names are spelled in general, never how this patient
 * spells theirs, so each defect is fixed on its own evidence and approved on
 * its own. A city is different: it is one of a few hundred places, each with one
 * written form, and the catalogue asks this rule for that form — "the cleaned
 * name", one fix (1.1.4), of which the trimming and the casing are two halves
 * of the same sentence rather than two proposals. Splitting it would put
 * `"  DEN HAAG "` in front of a human twice to arrive at the same `"Den Haag"`.
 *
 * **What title case means for a Dutch city.** Capitalising every word is wrong
 * for the names this rule is most often pointed at, so four things temper it:
 *
 * - **The connectives stay down.** `Bergen op Zoom`, `Alphen aan den Rijn`,
 *   `Berkel en Rodenrijs` — `Bergen Op Zoom` is not how the place is written.
 *   A fixed list, like P04's particles and P38's aliases: a word on the list is
 *   lowered, every other word is capitalised, so a town this rule has never
 *   heard of is never quietly lower-cased.
 * - **A connective in first position is capitalised anyway.** `Den Haag`,
 *   `De Bilt`, `Ter Apel`. Nothing precedes it, so it opens the name.
 * - **A leading `'s` or `'t` stays down, and the word after the hyphen is
 *   raised.** `'s-Hertogenbosch`, `'t Harde`. The elision is written lower even
 *   at the start of the name, which is the one place where "capitalise the first
 *   letter" gives a visibly wrong answer.
 * - **A name opening `ij` takes both capitals.** `IJsselstein`, `IJmuiden`,
 *   `Capelle aan den IJssel`. `Ij` is a digraph split in half, and Dutch raises
 *   the pair or neither.
 *
 * Unlike P04, which fires only on a name written *entirely* in one case, this
 * rule fires on any casing that is not the written form — the catalogue says
 * "casing that is not title case", and `"ZwOlLe"` is as far from `Zwolle` as
 * `"ZWOLLE"` is. There is no half-shouted city worth keeping.
 *
 * An apostrophe inside the name raises nothing after it. P04 does raise there,
 * because `O'Brien` is a surname; no Dutch city is written that way, and raising
 * would turn `A'dam` — the alias P38 is written for — into `A'Dam`, mangling a
 * cell on its way to another rule.
 *
 * What this rule walks past:
 *
 * - **An empty cell, or one holding nothing but whitespace.** P40's finding.
 *   Cleaning `"   "` leaves nothing, and proposing an empty city would be
 *   proposing the very state P40 asks a human about — the same line P03 draws
 *   against P08.
 * - **A city already written the way the place is written.** Nothing to
 *   propose.
 * - **Every other column.** A shouted `full_name` is P04's, and this rule
 *   reports against the column it read (1.1.5).
 *
 * What it hands on, tidied:
 *
 * - **An alias.** `"DEN BOSCH"` comes back as `"Den Bosch"`, which is still not
 *   `'s-Hertogenbosch`. Which place an alias names is P38's fix and P38's
 *   approval (1.1.4); this rule only settles how the words are typed.
 * - **A cell that is not a city at all.** A postcode or a whole address gets its
 *   spacing and casing cleaned like anything else, and afterwards it is still a
 *   postcode in the city column — P39's finding, unaffected by the tidying.
 *   This rule tests how a value is written, not whether it names a place, and
 *   it is P04 walking the same line when it restores the case of an email
 *   address sitting in the name column.
 */

/** Any run of whitespace: ordinary spaces, tabs, newlines, non-breaking spaces. */
const WHITESPACE_RUN = /\s+/g;

/** A run of non-whitespace: one word of the city name. */
const TOKEN = /\S+/g;

/**
 * The words that stay in lower case inside a Dutch place name.
 *
 * A fixed list, held lower-cased because tokens are looked up lower-cased. It
 * covers the connectives that join the parts of a compound name — `Bergen op
 * Zoom`, `Alphen aan den Rijn`, `Huis ter Heide`, `Berkel en Rodenrijs`,
 * `Capelle aan den IJssel` — and nothing else. Anything not on it is
 * capitalised, so an unfamiliar town keeps its capital.
 */
const CONNECTIVES: ReadonlySet<string> = new Set([
  'aan',
  'bij',
  'de',
  'den',
  'der',
  'en',
  'het',
  'op',
  'ten',
  'ter',
  'van',
]);

/**
 * A leading elided article — `'s` in `'s-Hertogenbosch`, `'t` in `'t Harde`,
 * and the `'n` that follows the same pattern.
 *
 * The lookahead is what keeps it to the elision: the letter has to end the
 * token or be followed by something that is not a letter, so `'s-` and a bare
 * `'t` match and a word that merely opens with an apostrophe does not.
 */
const ELISION = /^['’][stn](?!\p{L})/u;

/**
 * Where a capital belongs: the first letter of the name, and the first letter
 * after a hyphen.
 *
 * The leading `[^\p{L}]*` lets a name that opens with punctuation still have its
 * first real letter raised. A second letter is captured alongside the first so
 * that an opening `ij` can be seen whole; it is handed back unchanged unless it
 * is the other half of that digraph.
 *
 * An apostrophe is deliberately not a boundary here — see the note on `A'dam`
 * above.
 */
const CAPITAL_POSITION = /(^[^\p{L}]*|-)(\p{L})(\p{L}?)/gu;

/** Trimmed at both ends, and every inner run of whitespace reduced to one space. */
function despaced(value: string): string {
  return value.trim().replace(WHITESPACE_RUN, ' ');
}

/**
 * One word of the name, lower-cased, with its opening letters raised again.
 *
 * The elision is taken off the front first and put back as it was, so the
 * capital lands on `Hertogenbosch` rather than on the `s` in front of it.
 */
function capitalised(token: string): string {
  const lowered = token.toLowerCase();
  const elision = ELISION.exec(lowered);
  const prefix = elision === null ? '' : elision[0];

  const raised = lowered.slice(prefix.length).replace(
    CAPITAL_POSITION,
    (_match, before: string, letter: string, following: string) =>
      // `ij` is one letter as far as capitals are concerned.
      before + (letter === 'i' && following === 'j' ? 'IJ' : letter.toUpperCase() + following),
  );

  return prefix + raised;
}

/**
 * The whole name in the casing the place is written in.
 *
 * Rewritten word by word through `replace`, so whatever separates the words is
 * handed back as it stands — by the time this runs, `despaced` has already made
 * every separator a single space.
 */
function titleCased(value: string): string {
  let index = 0;

  return value.replace(TOKEN, (token) => {
    // A connective opens the name when nothing precedes it: `Den Haag`, not
    // `den Haag`.
    const isConnective = index > 0 && CONNECTIVES.has(token.toLowerCase());
    index += 1;

    return isConnective ? token.toLowerCase() : capitalised(token);
  });
}

/** The cleaned city name: spacing tidied, then casing put back. */
function cleaned(value: string): string {
  return titleCased(despaced(value));
}

export const p37: CatalogueRule = {
  ruleId: 'P37',
  version: 1,
  ruleName: 'Patient city has stray whitespace or the wrong casing',
  description:
    'The city is padded at the ends, spaced out inside, or typed in casing that is not the ' +
    'way the place is written — shouted, all lower case, or somewhere in between. The ' +
    'column was self-reported into a free-text box, so one town arrives under several ' +
    'spellings that differ only in spacing and case, and nothing that groups patients by ' +
    'where they live can put them together. The cleaned city name is proposed — ends ' +
    'trimmed, each run of spacing reduced to one space, and each word given a capital, ' +
    'with the Dutch connectives aan, bij, de, den, der, en, het, op, ten, ter and van left ' +
    "down inside the name, a leading 's or 't left as it is written, and a name opening IJ " +
    'given both capitals. Nothing else about the value is changed: which place an alias ' +
    'names, and whether the cell holds a city at all, are other rules and other decisions.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every city that would
   * change (1.1.14). Tests `city` and changes `city` (1.1.5), so an approved row
   * stops matching the next time the rules run — the proposal is already the
   * cleaned form, and cleaning it again gives it straight back.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.city;

      // The column holds nothing at all. An absent city is P40's finding, and
      // there is nothing here to clean (1.1.4).
      if (previous === null) {
        continue;
      }

      const next = cleaned(previous);

      // Nothing but whitespace, so the clean leaves nothing. Proposing an empty
      // city would be proposing the very state P40 calls an empty city and asks
      // a human about.
      if (next.length === 0) {
        continue;
      }

      // Nothing to propose when the city is already written this way.
      if (next === previous) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `city`, so the id
        // is only the address of the row — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'city',
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
