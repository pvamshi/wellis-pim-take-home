import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P14 — a patient's `email` holding a placeholder rather than an address:
 * `test@test.com`, `noemail@`, `x@x.x`.
 *
 * These are not mistakes. Somebody met a field that would not let them continue
 * without an address, had none to give, and typed something the field would
 * accept. The export notes call this column the primary contact and say one of
 * the later automations used it as a login, so the cost of that is the whole of
 * what this rule is for: nothing sent to this patient ever arrives, nobody can
 * sign in as them, and — unlike a blank — the row reads as complete from every
 * angle that only counts empties. A placeholder is the failure that survives a
 * data-quality report, because it was typed precisely to.
 *
 * Ambiguous, and not narrowly so. `test@test.com` does not encode an address a
 * better parser could recover; it encodes that nobody wrote one down. Nor can
 * the rest of the row supply it — `full_name`, `dob`, `bsn` and `city` identify
 * a person without saying where their post goes, and constructing
 * `jan.devries@` plus a guessed provider would invent a mailbox and hand a
 * login to whoever already owns it. So this rule reports and proposes nothing
 * (1.1.12), and its description is the whole of what the human reads. What they
 * do with it is supply the real address, or record that this person has none —
 * and only they can know which.
 *
 * **What counts as a placeholder is a fixed list of whole values, and nothing
 * else.** The rule never measures how filler-ish a local part looks and never
 * reasons from a short domain. A cell is either one of the strings written out
 * below, in which case it is a placeholder and nothing about that is a
 * judgement, or it is left alone. That discipline is P11's and it is here for
 * the same reason: every entry on such a list is a claim that no person alive
 * is reachable at that address, and a guessed claim is wrong more often than it
 * looks. `x.com` is a live provider, so `x@x.com` is not on the list; `.x` is
 * not a top-level domain at all, so `x@x.x` is. Widening the list is a new
 * version of this rule (1.1.1), written when somebody has seen the placeholders
 * that are actually in an export — not a guess made now. The cost of being
 * narrow is a placeholder that goes unreported; the cost of being wide is an
 * ambiguous finding against a working address, which wastes the time of the
 * very human this rule exists to ask.
 *
 * Two things about the comparison, and both are deliberate:
 *
 * - **The value is matched case-insensitively**, so `TEST@TEST.COM` is caught
 *   as surely as `test@test.com`. A placeholder shouted is the same
 *   placeholder.
 * - **The value is matched after trimming**, so `"  noemail@  "` is caught too,
 *   while `prev` reports the cell exactly as it is stored. Padding and capitals
 *   are P10's fix and P10's approval; if this rule went quiet until that fix
 *   had been approved, a placeholder would sit unreported behind a defect that
 *   has nothing to do with it, and no rule here waits on another rule's
 *   approval. The two findings on such a cell do not contradict each other:
 *   P10 proposes tidying the value, this rule says the tidied value still
 *   reaches nobody.
 *
 * Every placeholder on the list carries an `@`, and that is the boundary with
 * P12 rather than an accident of the three the catalogue names. A cell with no
 * `@` in it — `"n.v.t."`, `"geen"`, `"none"`, `"-"`, `"x"` — is not a
 * placeholder address, it is a note in the wrong box, and the sentence P12
 * shows about it is the true one. Sharing those cells would make this rule a
 * second, quieter copy of P12 (1.1.4).
 *
 * The cells this rule walks past, and whose they are:
 *
 * - **A real address, whatever else is wrong with it.** Padding and capitals
 *   are P10's, a misspelt provider is P11's. `mei.mulder@gmial.com` is a typo
 *   with a correction waiting for it, not a stand-in.
 * - **A value that is not an address at all** — P12's, as above.
 * - **Two or more addresses in one cell** — P13's. `"test@test.com;jan@live.nl"`
 *   is not on the list, and the question P13 asks about it, which of these is
 *   primary, is the useful one: there is a real address in that cell.
 * - **No value at all** — null, empty, or only whitespace. P15 asks the human
 *   for the missing address. A placeholder is the opposite of an empty cell —
 *   it is the cell pretending not to be empty — and the two sentences differ.
 *
 * `"noemail@"` is the one cell that is both P12's and this rule's: it is not an
 * address by shape, and it is a placeholder by meaning. P12 reports it, this
 * rule reports it, and the two agree — the cell holds no address anyone can be
 * reached at. The alternative is one of the two rules carrying a copy of the
 * other's list so it can stay quiet about a handful of strings, which is a
 * coupling that lets a new version of one rule silently change what the other
 * matches (1.1.1, D3). Two ambiguous findings that agree cost a human one extra
 * glance; that coupling costs correctness.
 *
 * The column is only read, and only this one. A placeholder in `phone` or a
 * test name in `full_name` is another rule's business: this rule tests `email`
 * and reports against `email` (1.1.5).
 */

/**
 * The fixed list: every value that is a placeholder and not an address, written
 * in lower case because that is how the comparison is made.
 *
 * Each entry earns its place by being a string nobody is reachable at — either
 * because the domain cannot exist, or because the value says in words that
 * there is no address. Nothing here is a near miss of a working mailbox.
 */
const PLACEHOLDER_ADDRESSES = new Set([
  // `test@test.com` and the two spellings of the same stand-in that differ only
  // in the suffix somebody reached for. `.test` is reserved and resolves
  // nowhere (RFC 2606), and `test.nl` is what the same reflex types in Dutch.
  'test@test.com',
  'test@test.nl',
  'test@test.test',
  // `example.com` is reserved for documentation (RFC 2606). It is the address
  // people copy out of a form's own help text.
  'test@example.com',
  // The value that says in words that there is no address, with the dangling
  // `@` the form insisted on and the spellings of the same sentence.
  'noemail@',
  'no-email@',
  'nomail@',
  'noemail@noemail.com',
  // One filler character on each side. Neither `.x` nor `.a` is a top-level
  // domain, so these deliver nowhere and never did.
  'x@x.x',
  'a@a.a',
]);

export const p14: CatalogueRule = {
  ruleId: 'P14',
  version: 1,
  ruleName: 'Patient email is a placeholder',
  description:
    "This patient's email column holds a placeholder rather than an address — a stand-in " +
    'such as test@test.com, noemail@ or x@x.x, typed to get past a field that would not ' +
    'let anyone continue without one. The column is the primary contact and was also used ' +
    'as a login, so nothing sent to this patient arrives and nobody can sign in as them, ' +
    'while the row still counts as having an address. What this person can actually be ' +
    'reached at is nowhere in the export — a name or a date of birth identifies someone ' +
    'without saying where their post goes — so a human has to supply the real address or ' +
    'record that there is none.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every cell holding a
   * placeholder (1.1.14). Tests `email` and reports against `email` (1.1.5), so
   * a row whose human has put a real address in the column stops matching the
   * next time the rules run.
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
      // and an absent address is not a pretended one (1.1.4).
      if (previous === null) {
        continue;
      }

      // Padding and capitals are P10's to fix, and neither changes what the
      // cell means: a placeholder is a placeholder shouted or spaced. Matching
      // through them is what keeps this rule from waiting on another rule's
      // approval.
      const value = previous.trim().toLowerCase();

      // Nothing but whitespace, which is the same absence with padding on it.
      // P15's, for the same reason.
      if (value.length === 0) {
        continue;
      }

      // Not on the list. That makes it an address as far as this rule is
      // concerned — a real one (left alone), one with something else wrong with
      // it (P10, P11), one that is not an address at all (P12), or two of them
      // in one cell (P13). Each of those rules reports the cell as it stands.
      if (!PLACEHOLDER_ADDRESSES.has(value)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `email`, so the
        // id is only the address of the row — whatever is wrong with the id
        // itself belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'email',
        // Reported verbatim, padding and capitals and all, so the human reads
        // what is really in the cell and not a tidied version of it.
        prev: previous,
        // No value is proposed, and none can be (1.1.12).
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
