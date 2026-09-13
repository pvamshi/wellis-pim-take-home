import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P09 — a patient's `full_name` holding a single word, `"Jan"`, so there is no
 * surname in the row at all.
 *
 * Half a name identifies nobody. A letter opens `"Beste Jan"` and is addressed
 * to a house that holds three of them; a screen shows a patient the staff
 * cannot tell from the next one; the column sorts under a given name for this
 * row and under a surname for every other. It is also what two of the duplicate
 * rules compare on — `"Jan"` matches every Jan in the export on a normalised
 * name and matches the real second signup of this person no better than it
 * matches a stranger.
 *
 * Ambiguous twice over, and both halves of it are beyond the export. The
 * missing word cannot be computed: `bsn`, `dob` and `city` say nothing about
 * what someone is called, and an email address only hints — `j.smit@gmail.com`
 * is written by Jan Smit, by Julia Smit and by a household mailbox alike, and
 * filling the column from a hint would invent a person. And the row does not
 * even say which half is here: `"Jan"` is a given name with the surname gone,
 * `"Berg"` a surname with the given name gone, and nothing in the cell marks
 * which of the two it is. So this rule reports and proposes nothing (1.1.12),
 * and its description is the whole of what the human reads.
 *
 * One word means one *name part*, counted after the ends are trimmed. Two
 * things separate one name part from the next here:
 *
 * - whitespace, which is how a name is written — and trimming first is what
 *   keeps `"  Jan  "` a single word, because the padding around it is P03's
 *   fix and not a second name.
 * - the comma, because P05 owns the comma-inverted name and `"Berg,Jan"` holds
 *   both halves of one with no space between them. Calling that row
 *   surname-less would say "there is no surname here" about a cell whose
 *   surname is the first thing in it, and about a row P05 is already restoring
 *   to reading order. A comma with nothing on one side of it — `"Berg,"` — is
 *   a stray character that P05 walks past, and it is still one word, so it is
 *   reported like any other.
 *
 * Nothing reaches inside a word. `"Anne-Marie"` and `"O'Brien"` are one name
 * part each and are reported, exactly as they read: a hyphen joins two given
 * names into one, an apostrophe belongs to the surname it sits in, and a rule
 * that split on either would be a rule that invents a surname out of half of
 * one. A dot is left alone for the same reason — `"J.Smit"` is one word here,
 * and it is one a human is right to be asked about, since a row whose whole
 * name is an initial glued to a surname is not a written-out name either.
 *
 * Three kinds of cell are somebody else's, and each is walked past on purpose:
 *
 * - no name at all — `null`, empty, or nothing but whitespace. Zero words is
 *   not one word, and P08 already asks the human for that row's name (1.1.4).
 * - contact detail filling the whole cell, `"jan.devries@gmail.com"` or
 *   `"06-53549409"`. P07 reports those, and its sentence is the true one: the
 *   cell holds no name, so it holds no half of one either, and "there is no
 *   surname here" would tell a human there is a given name in a cell that has
 *   none. A run of digits too short or too long to be a phone number —
 *   `"12345"` — is not contact detail to P07 and stays here, which is the
 *   handoff P07 wrote down.
 * - two or more words, however wrong they are. `"JAN DE VRIES"` is P04's,
 *   `"  Jan  de Vries "` is P03's, `"Dhr. Jan"` is P06's — a title is two
 *   words with the name, and taking it off is P06's fix and P06's approval.
 *   When that fix lands the row is one word and comes back here, which is the
 *   ordinary way round: a rule reports what the cell says today, and this cell
 *   today has two words in it.
 *
 * The column is only read, and only this one. Whatever `email`, `phone` or
 * `legacy_id` holds is another rule's business — this rule tests `full_name`
 * and reports against `full_name` (1.1.5).
 */

/** What separates one name part from the next: whitespace, or a comma. */
const NAME_PART_SEPARATOR = /[\s,]+/;

/**
 * An email address filling the whole value, and a phone number filling the
 * whole value — P07's two shapes, written out again here rather than imported.
 *
 * A rule is a file of its own and reads no other rule's code: P07 may be
 * revised into a v2 tomorrow, and a shared constant would silently change what
 * *this* version of P09 matches, which is the one thing a `(ruleId, version)`
 * key exists to prevent (1.1.1). What P09 needs from them is only the boundary
 * — these cells are P07's finding, not this one's — so the copy is deliberate
 * and the two are free to diverge.
 */
const EMAIL_SHAPED = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/;
const PHONE_PUNCTUATION = /[\s().\-/]+/g;
const PHONE_SHAPED = /^\+?\d{7,15}$/;

/**
 * The words of the name: the trimmed value cut on whitespace and commas, with
 * the empty pieces a leading or trailing comma leaves behind dropped.
 */
function nameParts(value: string): string[] {
  return value
    .trim()
    .split(NAME_PART_SEPARATOR)
    .filter((part) => part.length > 0);
}

/**
 * True when the one word in the cell is contact detail rather than a name.
 *
 * Only ever asked about a value that is already a single word, so the
 * punctuation `PHONE_SHAPED` strips cannot run two words together on the way
 * to it.
 */
function isContactDetail(value: string): boolean {
  const core = value.trim();

  return EMAIL_SHAPED.test(core) || PHONE_SHAPED.test(core.replace(PHONE_PUNCTUATION, ''));
}

export const p09: CatalogueRule = {
  ruleId: 'P09',
  version: 1,
  ruleName: 'Patient name is a single word with no surname',
  description:
    "This patient's name is a single word, so the row carries no surname — or no given " +
    'name, because nothing in the cell says which half of the name survived. The missing ' +
    'half cannot be worked out from the rest of the row: a date of birth or an email ' +
    'address identifies someone without naming them, so it has to come from a human or ' +
    'from a source outside this export.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every name that is a
   * single word (1.1.14). Tests `full_name` and reports against `full_name`
   * (1.1.5).
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.fullName;

      // The column holds nothing at all. An absent name is P08's finding, and
      // a cell with no words in it has no missing second word (1.1.4).
      if (previous === null) {
        continue;
      }

      // One word, and one only. Nothing, or two and more, is another rule's:
      // P08 owns the empty cell, and P03, P04, P05 and P06 own the names that
      // are wrong in some way that leaves both halves standing.
      if (nameParts(previous).length !== 1) {
        continue;
      }

      // The one word is an email address or a phone number. P07 reports that
      // cell, and reports it as what it is — a row with no name in it at all,
      // rather than a name missing its other half.
      if (isContactDetail(previous)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `full_name`, so
        // the id is only the address — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'full_name',
        // Reported verbatim, padding and punctuation and all, so the human
        // reads what is really in the cell and not a tidied version of it.
        prev: previous,
        // No value is proposed, and none can be (1.1.12).
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
