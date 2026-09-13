import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P07 — a patient's `full_name` holding an email address or a phone number
 * instead of a name, `"jan.devries@gmail.com"` or `"06-53549409"`.
 *
 * Someone filling a form put their contact detail in the name box, or an
 * automation wrote the wrong field into this column. Either way the row has no
 * name in it: every screen that greets the patient greets an email address,
 * every letter is addressed to a phone number, and the duplicate rules that
 * compare on a normalised name compare on something that was never one.
 *
 * Ambiguous, and unavoidably so: a name cannot be computed from contact detail.
 * `"j.smit@gmail.com"` might be Jan Smit, Julia Smit or the shared mailbox of a
 * household, and a phone number says nothing at all about who answers it. The
 * rule can only say that this cell is not a name; which name belongs here is a
 * human's answer, from a source this export does not contain (1.1.12).
 *
 * Instead of a name, not alongside one. `"Jan de Vries <jan@x.nl>"` is left
 * alone, and so are `"Jan de Vries jan@x.nl"` and `"jan@x.nl Jan de Vries"`:
 * the row does have a name in it, and what to do with the rest of that value is
 * a different question from the one the catalogue asks here. The test is the
 * whole cell, so a value that is contact detail end to end is reported and a
 * value that merely carries some is not.
 *
 * Both halves hold to that, by different means, because what keeps a name
 * visible differs between them. A phone number is digits, so
 * the letters of a name are what give it away and the number test lets them
 * through untouched — punctuation comes out, letters never do, and any letter
 * left standing means the cell is not a number. An email address is letters
 * too, so that tell is not available to the address test; what is left is the
 * space between the words of a name, and the address test is careful not to
 * take it. It trims the cell's ends and tests what is between them as one
 * piece, so a cell with a gap in the middle of it is never an address here.
 *
 * A stray space inside an address — `"jan .vries@ gmail.com"` — is the price of
 * that, and it is the right way round. Squeezing the spaces out first would
 * report a typo'd address and would also report `"Jan de Vries jan@x.nl"` and
 * `"Jan @ Wellis"`, and there is no reading of the value that tells the two
 * apart afterwards. A rule whose whole output is "there is no name here" must
 * not say it to a human looking at a row that names someone.
 *
 * The column is only read. Nothing here touches `email` or `phone` — the
 * address in this cell may be the same one the `email` column already holds, or
 * a different one, and either way this rule tests `full_name` and reports
 * against `full_name` (1.1.5).
 */

/**
 * An email address filling the whole value.
 *
 * The practical shape, not RFC 5322: letters, digits and `. _ % + -` before the
 * `@`, letters, digits, `.` and `-` after it. Anchored at both ends, so the
 * value has to *be* an address rather than contain one. Whitespace is in
 * neither class, which is what leaves every name with contact detail beside it
 * alone — `"Jan de Vries jan@x.nl"`, `"jan@x.nl Jan de Vries"` and `"Jan de
 * Vries <jan@x.nl>"` all break on the spaces, and `"Jan @ Wellis"` with them.
 *
 * A dot in the domain is not required. `"jan@localhost"` is still contact
 * detail typed into the name box, and demanding a dot would only mean the
 * malformed addresses go unreported — which is the wrong way round for a rule
 * whose whole output is a question to a human.
 */
const EMAIL_SHAPED = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/;

/**
 * What separates the digits of a written phone number: spaces, dots, dashes,
 * brackets and the slash people use between two numbers.
 *
 * Removed before the value is tested, because `"(06) 5354-9409"` and
 * `"0653549409"` are the same number written two ways, and this rule is asking
 * what the value *is*, not how it was punctuated.
 */
const PHONE_PUNCTUATION = /[\s().\-/]+/g;

/**
 * A phone number filling the whole value: an optional leading `+`, then digits
 * and nothing else.
 *
 * Seven digits at the low end and fifteen at the high end. Fifteen is E.164's
 * limit, so nothing longer is a phone number anywhere in the world; seven is
 * the shortest run of digits worth calling one, and it keeps this rule off the
 * short digit blobs — `"12345"` is a single token with no surname in it, which
 * is P09's finding, and answering it here would be a second rule (1.1.4).
 */
const PHONE_SHAPED = /^\+?\d{7,15}$/;

/**
 * True when the value is an email address rather than a name.
 *
 * The padding around the cell is taken off first, because `"  jan@x.nl  "` is
 * an address that someone's export padded and P03 owns the padding. Nothing
 * inside the trimmed value is touched: a space between two words is the one
 * thing that still marks a name as a name once the `@` is in the cell, so it
 * has to survive into the test.
 */
function isEmailAddress(value: string): boolean {
  return EMAIL_SHAPED.test(value.trim());
}

/**
 * True when the value is a phone number rather than a name.
 *
 * Letters are not in `PHONE_SHAPED` and are not stripped on the way to it, so
 * `"Jan de Vries 06-53549409"` fails here for the same reason its email sibling
 * fails above: the cell still says who the person is.
 */
function isPhoneNumber(value: string): boolean {
  return PHONE_SHAPED.test(value.replace(PHONE_PUNCTUATION, ''));
}

export const p07: CatalogueRule = {
  ruleId: 'P07',
  version: 1,
  ruleName: 'Patient name is an email address or a phone number',
  description:
    "This patient's name is not a name — the column holds an email address, or a phone " +
    'number, written where the name should be. Nothing in the row says what the person is ' +
    'called: an address and a number identify how to reach someone, never who they are, so ' +
    'the name has to come from a human or from a source outside this export.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every name that is
   * contact detail (1.1.14). Tests `full_name` and reports against `full_name`
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
      // there is no contact detail here to report (1.1.4).
      if (previous === null) {
        continue;
      }

      // Empty, or nothing but whitespace. P08's again: a row with no name is
      // not a row whose name is an email address.
      if (previous.trim().length === 0) {
        continue;
      }

      if (!isEmailAddress(previous) && !isPhoneNumber(previous)) {
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
