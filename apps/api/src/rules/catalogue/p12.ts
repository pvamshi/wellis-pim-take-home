import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P12 — a patient's `email` holding something that is not an email address:
 * `"n.v.t."`, `"onbekend"`, a phone number typed into the wrong box, an address
 * with a gap in the middle of it, or a domain that stops before it is one.
 *
 * The export notes call this column the primary contact and say one of the
 * later automations used it as a login. A cell that is not an address fails at
 * both jobs and fails silently: nothing is ever sent, nobody can log in, and
 * the column still looks populated from every angle that only counts empties.
 * `"geen"` is worse than blank, because blank is at least honest — P15 finds
 * the honest ones, and this rule finds the cells that are pretending.
 *
 * Ambiguous, and not narrowly so. `"n.v.t."` does not encode an address that a
 * better parser could recover; it encodes that nobody wrote one down. Nor can
 * the rest of the row supply it: `full_name`, `dob`, `bsn` and `city` identify
 * a person without saying where their post goes, and constructing
 * `jan.devries@` + a guessed provider would invent a mailbox and hand a login
 * to whoever already owns it. Even the near misses are guesses —
 * `"willem.ricci @icloud.com"` may be a stray space or may be two fields run
 * together, and `"jan@gmail"` is missing a suffix nobody here knows. So this
 * rule reports and proposes nothing (1.1.12), and its description is the whole
 * of what the human reads.
 *
 * What counts as an address here is shape, not existence. This rule cannot know
 * whether a mailbox is live, and does not try: it asks whether the cell is
 * written the way an address is written — something, one `@`, then a domain of
 * dotted labels ending in letters. A cell that passes is left alone however
 * wrong it is in some other way, because every other way is another rule's:
 * capitals and padding are P10's, a misspelt provider is P11's, and a
 * placeholder that is perfectly well-formed — `test@test.com`, `x@x.x` — is
 * P14's. A cell that fails is reported whole, before anyone has tidied a
 * fragment of it (1.1.4).
 *
 * The shape test is deliberately a little stricter than "has an `@` in it",
 * because the catalogue asks for two things and only the first is the `@`:
 *
 * - **No `@` at all.** `"n.v.t."`, `"geen"`, `"-"`, `"x"`, `"06-53549409"`.
 *   There is no address in the cell and no half of one.
 * - **Otherwise not an address.** Nothing on one side of the `@`
 *   (`"noemail@"`, `"@gmail.com"`), two of them (`"jan@@gmail.com"`), a space
 *   inside (`"willem.ricci @icloud.com"`), punctuation where a dot belongs
 *   (`"jan.smit@gmail,com"`), a stray character on the end
 *   (`"jan@gmail.com,"`), a domain with no suffix (`"jan@gmail"`), an empty
 *   label (`"jan@.com"`, `"jan@gmail."`), or a suffix that is not letters
 *   (`"jan@gmail.123"`, `"jan@192.168.1.1"`). Each of those is a value nothing
 *   will deliver to, and none of them is any other rule's: P10 only folds case
 *   and trims ends, P11 only swaps a domain that is on its list, and both of
 *   them walk past a cell like this on purpose.
 *
 * Three cells are somebody else's, and each is walked past here:
 *
 * - **No value at all** — `null`, empty, or nothing but whitespace. Nothing is
 *   not a wrong address, it is an absent one, and P15 already asks the human
 *   for it — a serious ask, since the notes say the address was a login
 *   (1.1.4).
 * - **Two or more addresses in one cell**, `"eva@gmial.com;eva@live.nl"`. P13
 *   owns those, and the question it asks — which of these is the primary one? —
 *   is not the question this rule asks. Saying "this is not an address" about a
 *   cell holding two of them would be false, and would put the same row in
 *   front of the human twice under two different sentences.
 * - **A well-formed address**, whatever is wrong with it otherwise. Padding and
 *   capitals are P10's, a misspelt provider is P11's, a placeholder is P14's.
 *
 * `"noemail@"` is the one cell that is both this rule's and P14's: it is not an
 * address by shape, and it is also a placeholder by meaning. It is reported
 * here, because the sentence this rule shows — the cell holds no address — is
 * the true one about a value with no domain, and because the alternative is
 * this rule carrying a copy of P14's list so it can stay quiet about three
 * strings. Two ambiguous findings on one cell cost a human one extra glance and
 * agree with each other; a coupling between two rules' code costs a version of
 * one rule silently changing what the other matches (1.1.1, D3).
 *
 * The padding around the value is not this rule's either. The test is made
 * against the trimmed value, so `"  jan@gmail.com  "` is an address here and
 * P10's to trim — but `prev` reports the cell exactly as it is stored, padding
 * and all, so the human reads what is really in the column.
 *
 * The column is only read, and only this one. Whatever `full_name`, `phone` or
 * `legacy_id` holds is another rule's business — this rule tests `email` and
 * reports against `email` (1.1.5).
 */

/**
 * An email address as one is actually written: a local part, one `@`, then a
 * domain of dotted labels whose last one is letters.
 *
 * Not a validator for whether a mailbox exists, and not RFC 5322 — the local
 * part is left as permissive as the shape allows, because the weird ones are
 * real (`jan_smit+news@`, `o'brien@`) and this rule has no business rejecting a
 * mailbox someone can be reached at. What it does insist on is the structure
 * that makes a string deliverable at all:
 *
 * - **The local part holds no whitespace, no second `@`, and none of `,;/:`**.
 *   The first three say the cell is not one address; the colon catches
 *   `"mailto:jan@gmail.com"`, a link rather than an address, and is a character
 *   no unquoted local part may carry anyway.
 * - **The domain is at least two labels.** `"jan@gmail"` reaches nothing —
 *   there is a suffix missing and no rule here knows which. A label starts and
 *   ends alphanumeric and may hold hyphens inside, which is what a hostname is.
 * - **The last label is letters.** Any letters, and as few as one: `x@x.x` is a
 *   perfectly well-formed address and a placeholder, so it stays P14's rather
 *   than being caught here on a length rule invented for the purpose. A numeric
 *   suffix is not a domain, so `"jan@192.168.1.1"` is reported.
 *
 * Unicode-aware, so a letter is a letter: `"jan@müller.de"` is an address and
 * is left alone. An ASCII-only class would report a working domain as junk,
 * which is the one mistake an ambiguous rule can still make — wasting the time
 * of the human it is asking.
 */
const ADDRESS = /^[^\s@,;/:]+@(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}+$/u;

/**
 * What P13 says holds two addresses apart: a slash, a semicolon or a comma.
 *
 * Written out here rather than imported from P13. A rule is a file of its own
 * and reads no other rule's code: P13 may be revised into a v2 tomorrow, and a
 * shared constant would silently change what *this* version of P12 matches,
 * which is the one thing a `(ruleId, version)` key exists to prevent (1.1.1).
 * What P12 needs from P13 is only the boundary, so the copy is deliberate.
 */
const ADDRESS_SEPARATOR = /[/;,]/;

/**
 * True when the cell is P13's rather than this rule's: it splits on P13's
 * separators into two or more pieces, and every piece is itself an address.
 *
 * "Two or more addresses" is what P13 catches, so both halves of that matter.
 * `"jan@gmail.com, geen"` splits into an address and a word, which is not two
 * addresses — it is a cell that is not an address, and it is reported here.
 */
function holdsSeveralAddresses(value: string): boolean {
  const pieces = value
    .split(ADDRESS_SEPARATOR)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);

  return pieces.length > 1 && pieces.every((piece) => ADDRESS.test(piece));
}

export const p12: CatalogueRule = {
  ruleId: 'P12',
  version: 1,
  ruleName: 'Patient email is not an email address',
  description:
    "The value in this patient's email column is not an email address — it has no @ in " +
    'it at all, or what it does have is not an address either: a note like "n.v.t." or ' +
    '"geen", a phone number typed into the wrong box, an address with a gap in the middle ' +
    'of it, or a domain that stops before it is one. The column is the primary contact ' +
    'and was used as a login, so this row can neither be written to nor signed in as. ' +
    'What the real address is cannot be read out of the rest of the row — a name or a ' +
    'date of birth identifies someone without saying where their post goes — so it has to ' +
    'come from a human or from a source outside this export.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every cell that holds
   * something which is not an address (1.1.14). Tests `email` and reports
   * against `email` (1.1.5).
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.email;

      // The column holds nothing at all. An absent address is P15's finding,
      // and an absent address is not a wrong one (1.1.4).
      if (previous === null) {
        continue;
      }

      const trimmed = previous.trim();

      // Nothing but whitespace, which is the same absence with padding on it.
      // P15's, for the same reason.
      if (trimmed.length === 0) {
        continue;
      }

      // A well-formed address. Whatever else is wrong with it — capitals and
      // padding (P10), a misspelt provider (P11), a placeholder (P14) — is that
      // rule's finding and that rule's approval.
      if (ADDRESS.test(trimmed)) {
        continue;
      }

      // Two or more addresses crammed into one cell. P13 reports that cell and
      // asks the human which of them is primary, which is a different question
      // from the one asked here.
      if (holdsSeveralAddresses(trimmed)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `email`, so the
        // id is only the address of the row — whatever is wrong with the id
        // itself belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'email',
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
