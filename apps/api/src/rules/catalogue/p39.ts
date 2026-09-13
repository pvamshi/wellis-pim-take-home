import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P39 — a patient's `city` holding a postcode or a whole address instead of the
 * name of a town: `"1012 AB"`, `"1012AB"`, `"1012"`, `"Kerkstraat 12"`,
 * `"Kerkstraat 12, Amsterdam"`, `"Kerkstraat 12, 1012 AB Amsterdam"`,
 * `"Postbus 123, Zwolle"`.
 *
 * The export notes say this column is self-reported, and a self-reported box
 * labelled "city" is filled in by somebody looking at the address they have in
 * front of them. Some copy the postcode across, because in the Netherlands a
 * postcode and a house number *are* the address and the town is a detail that
 * follows from them. Some paste the whole address line in one go. Either way
 * the column no longer holds what it says it holds: every screen that shows
 * where the patient lives shows a postcode, and anything that counts patients
 * by town counts each of these as a town of its own — a hundred one-row towns
 * spelled like invoices.
 *
 * **The test is a number anywhere in the cell**, and that is exactly as wide as
 * the catalogue entry is. A postcode is made of digits. A house number is a
 * number and is what turns a street into an address. No town is written with a
 * number in it — not in this export's twenty, not anywhere in the country the
 * export comes from — so the digit is not a heuristic about what the cell
 * probably is, it is a fact about what the cell is not. `"1012 AB"` fails it as
 * a postcode alone, `"Kerkstraat 12, 1012 AB Amsterdam"` fails it as a whole
 * address line, and both are the one finding the catalogue names.
 *
 * Ambiguous, and every reading of the cell is what makes it so:
 *
 * - **A postcode alone does not give up its town here.** Four digits and two
 *   letters do name a street in a specific place, and that is a lookup in a
 *   postcode table — a table this export does not carry and this rule is not
 *   given. Deriving `Amsterdam` from `1012 AB` out of general knowledge is the
 *   guess P38 refused to make about `R'dam`, made with worse evidence: the
 *   nearby ranges belong to other municipalities, and a wrong answer here files
 *   the patient in the wrong town while looking authoritative.
 * - **An address line has no part that is reliably the city.** Reading the last
 *   token of `"Kerkstraat 12, 1012 AB Amsterdam"` gives `Amsterdam` and reading
 *   the last token of `"Dorpsstraat 4, 1394 Nederhorst den Berg"` gives `Berg`,
 *   which is not a town at all. A street can be named after a city
 *   (`Amsterdamsestraatweg 12, Utrecht`), a line can end in a country or a
 *   district, and a cell can hold the address of a workplace rather than a home.
 *   Picking a substring is deciding which part of somebody's address is the
 *   town, and picking wrong writes a street name into the city column.
 * - **Taking the number out is not a fix either.** `"Kerkstraat 12"` without
 *   the `12` is a street, not a town, and the proposal would look like a
 *   tidy-up while leaving the column just as wrong and no longer obviously so.
 * - **The town is nowhere else in the row.** `full_name`, `dob`, `bsn`,
 *   `phone`, `email` — none of them says where a person lives, and a rule that
 *   reached for one would be breaking 1.1.5 to make a guess it still could not
 *   stand behind.
 *
 * So the rule reports and proposes nothing (1.1.12), and its description is the
 * whole of what the human reads. What resolves the row is a person who can see
 * the address the cell was copied from, writing the town into this column and
 * putting the rest of the address somewhere this column is not.
 *
 * **The cell is read as it stands, and no rule goes first.** P37 would tidy the
 * spacing and casing of `"  kerkstraat 12 "` and says in as many words that
 * afterwards it is still an address in the city column and still this rule's
 * finding; the tidying moves no digit, so this rule finds the same cell before
 * or after, and waits on nobody's approval. P38 matches an alias only as the
 * whole cell, so `"Kerkstraat 12, A'dam"` is not an alias there and arrives
 * here whole, which is the handoff that test names.
 *
 * What it walks past:
 *
 * - **A town written in letters**, however badly. `"AMSTERDAM"` and
 *   `"amsterdam"` are P37's casing, `"A'dam"` is P38's alias, `"Zwolle"` is
 *   simply right. None of them holds a number, and none of them is a postcode
 *   or an address.
 * - **A place name with a number in it, if one ever arrives.** There is none in
 *   this country, and if some later export carries one, the answer is a new
 *   version of this rule that names it (1.1.1) rather than a silent exception
 *   here.
 * - **An address with no number in it at all** — `"Kerkstraat"`, `"Postbus"`.
 *   Nothing in the cell distinguishes a bare street name from a town this rule
 *   has never heard of, and telling them apart would need a list of every place
 *   in the country. That list is the guess P38 refused, and a rule whose whole
 *   output is "there is no city here" must not say it to a row that names one.
 * - **A cell with nothing in it.** `null`, `''` and a cell of nothing but
 *   whitespace hold no number, so they fail the test on their own; a row with
 *   no city is P40's finding.
 * - **Every other column.** A postcode in `full_name` is not this rule's, and
 *   the row's `legacy_id` is only the address of the row — its own defects are
 *   P01's and P02's. The column read is the column reported against (1.1.5),
 *   which is what makes the rule self-terminating: a human writes the town into
 *   the cell this rule read and the row stops matching, or empties it, and the
 *   row becomes P40's ordinary empty finding rather than this one.
 */

/**
 * A number, anywhere in the cell, in any script — `\p{N}` under the `u` flag
 * rather than `[0-9]`, for the reason P34 reaches for `\p{L}`: a postcode typed
 * in another numeral system is no more a town name than `1012 AB` is, and a
 * rule that read only ASCII digits would report the one and migrate the other
 * as a city.
 *
 * A letter is `\p{L}` and never `\p{N}`, so no name is caught by this, and the
 * marks an address is punctuated with — commas, dots, hyphens — are punctuation
 * and match nothing here either. What matches is the postcode and the house
 * number, which is the whole of what the catalogue entry names.
 */
const NUMBER = /\p{N}/u;

export const p39: CatalogueRule = {
  ruleId: 'P39',
  version: 1,
  ruleName: 'Patient city is a postcode or a whole address',
  description:
    "This patient's city has a number in it, so the cell is not the name of a town — it " +
    'holds a postcode such as 1012 AB or 1012, a street with its house number, or a whole ' +
    'address line with the postcode and the town run together in one cell. The column was ' +
    'self-reported, and whoever filled it in copied across the address they had in front ' +
    'of them; no town anywhere is written with a number in it, which is what gives the ' +
    'cell away. Anything that shows or counts where patients live reads this row as a town ' +
    'of its own. Nothing is proposed, because the town cannot be read out of the cell: a ' +
    'postcode names a town only through a postcode table, which this export does not ' +
    'carry, and an address line has no part that is reliably the town — the last word of ' +
    'one may be a district, a country, or half the name of a village. Deleting the number ' +
    'would leave a street name sitting in the city column and hide the problem rather than ' +
    'fix it. A human reads the address this cell was copied from, writes the town into ' +
    'this column, and puts the rest of the address somewhere this column is not, because ' +
    'this column holds one town name.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every `city` with a
   * number in it (1.1.14). Tests `city` and reports against `city` (1.1.5), so
   * a row whose human has written the town in — or cleared the cell, which is
   * then P40's finding — stops matching the next time the rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.city;

      // No value in the column at all. There is nothing here to read, and a row
      // with no city is P40's empty finding.
      if (previous === null) {
        continue;
      }

      // No number in the cell, so no postcode and no house number. Whatever
      // else is wrong with it — spacing, casing, an alias, a blank — belongs to
      // P37, P38 or P40, and this rule is not the one that catches what they
      // left. An empty cell and a cell of nothing but whitespace fail here too,
      // which is why they need no test of their own.
      if (!NUMBER.test(previous)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `city`, so the id
        // is only the address of the row — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'city',
        // Reported exactly as stored, punctuation and padding and all, so the
        // human reads the cell they would see in the row and can tell a bare
        // postcode from a whole address line.
        prev: previous,
        // No value is proposed, and none can be (1.1.12).
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
