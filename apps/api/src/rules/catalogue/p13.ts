import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P13 — a patient's `email` holding two or more addresses in one cell, split by
 * a slash, a semicolon or a comma: `"eva.smit@gmial.com;eva.smit@live.nl"`,
 * `"jan@gmail.com / jan.devries@work.nl"`.
 *
 * The export notes call this column the primary contact and say one of the
 * later automations used it as a login. Both jobs want one address and this
 * cell holds two, so the cell as it stands is not one either: nothing will
 * deliver to `"a@live.nl;b@gmail.com"`, and nobody signs in as it. It is a
 * failure that hides well — the column is populated, the value contains an `@`,
 * and every count of missing addresses walks straight past it — which is why it
 * gets a rule of its own rather than being left to whoever notices the bounce.
 *
 * How a cell ends up like this is ordinary: someone had two addresses and typed
 * both, an automation concatenated a patient's address with a partner's or a
 * GP's, or a spreadsheet paste carried a second cell across.
 *
 * Ambiguous, and for one reason: the cell holds the answer twice and does not
 * say which is the answer. Both addresses may be live. The second may be the
 * one the person actually reads; the first may be the one they stopped reading,
 * which is often exactly why a second was added. Either may belong to somebody
 * else entirely — a partner, a carer, a practice — and the rest of the row
 * cannot separate them: `full_name`, `dob` and `bsn` identify a person without
 * saying which mailbox is theirs, and `signup_date` does not record which
 * address was used to sign up. "Keep the first" is not a rule, it is a coin
 * toss with a login attached: picking wrong discards a working address and
 * hands an account to whoever owns the other one. So this rule reports and
 * proposes nothing (1.1.12), and its description is the whole of what the human
 * reads.
 *
 * What counts as two addresses, precisely, is two things and both halves
 * matter:
 *
 * - **Split by one of the separators the catalogue names** — `/`, `;` or `,`.
 *   Not a space. `"jan@gmail.com eva@live.nl"` is a cell no mail system
 *   accepts, but the catalogue names three separators and this rule builds
 *   exactly that; the cell is not lost either way, because P12 already reports
 *   it as a value that is not an address.
 * - **Every piece is itself written the way an address is written.**
 *   `"jan@gmail.com, geen"` splits into an address and a word, which is not two
 *   addresses — it is a cell that is not an address, and it is P12's. So is
 *   `"jan@gmail;eva@live.nl"`, where one half never reaches anyone. Insisting
 *   on every piece is what keeps a single cell in front of a human once, under
 *   one sentence, instead of twice under two that disagree.
 *
 * Empty pieces are dropped before counting, so a trailing separator does not
 * invent an address: `"jan@gmail.com;"` is one address with a stray character
 * on it — P12's finding — and not two.
 *
 * Every other cell in the column belongs to another rule, and each is walked
 * past here (1.1.4):
 *
 * - **One address, however else it is wrong.** Padding and capitals are P10's,
 *   a misspelt provider is P11's, a placeholder is P14's. Each of those
 *   proposes a value; this rule has none to propose, and reporting the same
 *   cell twice would make a human resolve a question nobody asked.
 * - **A cell that is not an address at all** — `"n.v.t."`, `"geen"`, a phone
 *   number, an address with a gap in it. P12's, and the sentence it shows is
 *   the true one about those cells.
 * - **No value at all** — null, empty, or only whitespace. P15 asks the human
 *   for the missing address, and an absent address is not two of them.
 *
 * The same address written twice, `"eva@live.nl;eva@live.nl"`, is reported like
 * the rest. The cell still holds two addresses split by a separator, and it
 * still delivers to nobody; that the obvious resolution is to keep one of them
 * does not make it this rule's to propose, because ambiguity is rule-wide
 * (1.1.12) and this rule proposes nothing anywhere. A human deletes the
 * repetition in a second — which they cannot do if no rule ever shows them
 * the row.
 *
 * The column is only read, and only this one. What `full_name` or `phone` holds
 * is another rule's business: this rule tests `email` and reports against
 * `email` (1.1.5). `prev` is the cell exactly as stored, padding and all, so
 * the human reads what is really in the column rather than a tidied version of
 * it.
 */

/**
 * What holds two addresses apart in one cell: a slash, a semicolon or a comma.
 * The three the catalogue names, and no others.
 */
const ADDRESS_SEPARATOR = /[/;,]/;

/**
 * An email address as one is actually written: a local part, one `@`, then a
 * domain of dotted labels whose last one is letters.
 *
 * Written out here rather than imported from P12, which tests the same shape
 * for the opposite purpose. A rule is a file of its own and reads no other
 * rule's code: P12 may be revised into a v2 tomorrow, and a shared constant
 * would silently change what *this* version of P13 matches, which is the one
 * thing a `(ruleId, version)` key exists to prevent (1.1.1, D3). The copy is
 * deliberate.
 *
 * Not a validator for whether a mailbox exists, and not RFC 5322 — the local
 * part stays permissive, because the weird ones are real (`jan_smit+news@`,
 * `o'brien@`) and a cell holding two working addresses is this rule's finding
 * whatever those addresses look like. What it insists on is the structure that
 * makes a string deliverable at all: no whitespace and no separator inside the
 * local part, a domain of at least two labels, and a last label that is
 * letters. Unicode-aware, so `"jan@müller.de"` is an address — an ASCII-only
 * class would read a working pair as junk and hand the cell to the wrong rule.
 */
const ADDRESS = /^[^\s@,;/:]+@(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}+$/u;

/**
 * True when the cell holds two or more addresses split by this rule's
 * separators: it breaks into more than one non-empty piece, and every piece is
 * itself an address.
 *
 * Empty pieces are dropped first, so `"jan@gmail.com;"` counts as one address
 * and not two. Each piece is trimmed before it is tested, because the space
 * after a semicolon is how people type a list, not a fourth separator.
 */
function holdsSeveralAddresses(value: string): boolean {
  const pieces = value
    .split(ADDRESS_SEPARATOR)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);

  return pieces.length > 1 && pieces.every((piece) => ADDRESS.test(piece));
}

export const p13: CatalogueRule = {
  ruleId: 'P13',
  version: 1,
  ruleName: 'Patient email holds more than one address',
  description:
    "This patient's email column holds two or more email addresses in the one cell, " +
    'separated by a slash, a semicolon or a comma. The column is the primary contact and ' +
    'was also used as a login, and both of those want a single address: as it stands ' +
    'nothing will be delivered to this patient and nobody can sign in as them. Which of ' +
    'the addresses is the primary one cannot be read out of the export — both may work, ' +
    'the second may be the one this person actually reads, and either may belong to ' +
    'someone else such as a partner or a practice — so a human has to choose which single ' +
    'address the column should hold.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every cell holding
   * more than one address (1.1.14). Tests `email` and reports against `email`
   * (1.1.5).
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.email;

      // The column holds nothing at all. P15 asks the human for the missing
      // address, and an absent address is not two of them (1.1.4).
      if (previous === null) {
        continue;
      }

      // The padding is not this rule's to read anything into — a list is a list
      // whether or not someone left a space at the end of it. It is P10's to
      // trim on a cell holding one address, and it is reported verbatim below.
      const trimmed = previous.trim();

      // Nothing but whitespace, which is the same absence with padding on it.
      // P15's, for the same reason.
      if (trimmed.length === 0) {
        continue;
      }

      // One address, or something that is not an address at all. Either way the
      // question this rule asks — which of these is primary? — has no meaning
      // for the cell, and the rule that owns it reports it whole: P10, P11 or
      // P14 for an address with something wrong with it, P12 for a value that
      // is not one.
      if (!holdsSeveralAddresses(trimmed)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `email`, so the
        // id is only the address of the row — whatever is wrong with the id
        // itself belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'email',
        // Reported whole, separators and padding and all. The human is being
        // asked to choose between the addresses in this cell, so they have to
        // see the cell.
        prev: previous,
        // No value is proposed, and none can be (1.1.12).
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
