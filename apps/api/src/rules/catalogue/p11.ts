import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P11 — a patient's `email` at a domain that is a known misspelling of a mail
 * provider: `gmial.com` for `gmail.com`, `hotmial.com` for `hotmail.com`.
 *
 * The export notes call this column the primary contact and say one of the
 * later automations used it as a login, so a mistyped domain is not a cosmetic
 * defect: nothing sent to `mei.mulder@gmial.com` ever arrives, and the person
 * behind that row cannot log in with the address they believe they typed. The
 * local part is right, the shape is right, and one transposed pair of letters
 * in the domain is the whole of what is wrong.
 *
 * Not ambiguous, and one thing makes it so: the list. `gmial.com` is not a mail
 * provider anybody signs up with, and there is exactly one address it was meant
 * to be, so the correction is a lookup and not a judgement. That is what the
 * catalogue means by "from a fixed list only" — the rule never measures how
 * close a domain is to a real one and never guesses from a near miss. A domain
 * is either a key in the table below, in which case its correction is known, or
 * it is left alone.
 *
 * **The list is the three the catalogue names, and nothing else.** Every extra
 * entry would be a new claim that some string is a misspelling of some provider
 * and never a domain in its own right, and that claim is wrong more often than
 * it looks: `gmail.co` is Colombia's, `live.com` and `live.nl` are both real
 * mailboxes. A rule that rewrites a working address has done more damage than
 * the defect it was cleaning. Widening the list is a new version of this rule
 * (1.1.1), written when someone has seen the domains that are actually in an
 * export — not a guess made here.
 *
 * Only the domain changes, and only into the spelling the list gives:
 *
 * - **The rest of the cell is kept byte for byte** — the local part's capitals,
 *   and any padding around the address. `" MEI.MULDER@GMIAL.COM "` is proposed
 *   as `" MEI.MULDER@gmail.com "`. Trimming it and folding its case is P10's
 *   fix and P10's approval; doing both here would be two fixes in one rule
 *   (1.1.4), and would make this rule's proposal unreadable as what it is —
 *   one wrong domain, corrected.
 * - **The domain is matched case-insensitively**, so `GMIAL.COM` is caught as
 *   surely as `gmial.com`. A domain is case-insensitive to every resolver that
 *   reads one, and a rule that only saw the lower-case spelling would leave the
 *   shouted rows broken until P10's fix had been approved — one rule waiting on
 *   another's approval, which no rule does.
 */

/**
 * A single address, and nothing more complicated than one: text, one `@`, more
 * text, with no whitespace anywhere in it.
 *
 * The gate, not a validator. This rule asks one question of the cell — is the
 * domain one of the three? — and that question only has an answer when the cell
 * holds one address with one domain. Three shapes fail it, and each belongs to
 * another rule that reports the cell whole rather than after this one has
 * corrected a fragment of it: no `@` at all (P12), more than one `@` or a gap
 * inside the address (P13, P12), and nothing on one side of the `@` (P14).
 */
const SINGLE_ADDRESS = /^[^\s@]+@[^\s@]+$/;

/**
 * The fixed list: a misspelt domain, in lower case, and the one domain it was
 * meant to be.
 *
 * The corrections are written lower case because that is how a domain is
 * written; a domain carries no case of its own, and this rule's business is the
 * spelling, not the capitals (P10's).
 */
const CORRECTED_DOMAINS = new Map<string, string>([
  // `a` and `i` transposed.
  ['gmial.com', 'gmail.com'],
  ['hotmial.com', 'hotmail.com'],
  // The `l` dropped.
  ['gmai.com', 'gmail.com'],
]);

export const p11: CatalogueRule = {
  ruleId: 'P11',
  version: 1,
  ruleName: 'Patient email is at a misspelt provider domain',
  description:
    "The patient's email address is at a domain that is a known misspelling of a mail " +
    'provider — gmial.com for gmail.com, say — so nothing sent to it arrives and the ' +
    'person cannot log in with it. The corrected address is proposed — the same address ' +
    'with its domain replaced by the one it was meant to be, taken from a fixed list of ' +
    'known misspellings, and nothing else about it changed.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every address whose
   * domain is on the list (1.1.14). Tests `email` and changes `email` (1.1.5),
   * so an approved row stops matching the next time the rules run — the
   * corrected domain is not a key in the list.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.email;

      // The column holds nothing at all, so there is no domain to read. An
      // empty address is P15's finding, and a serious one — the notes say the
      // address was a login.
      if (previous === null) {
        continue;
      }

      const trimmed = previous.trim();

      // Not one address, so there is no single domain to test: the cell is
      // empty (P15), holds something that is not an address (P12), or holds two
      // of them (P13). Each of those rules reports the cell as it stands.
      if (!SINGLE_ADDRESS.test(trimmed)) {
        continue;
      }

      const at = trimmed.indexOf('@');
      const domain = trimmed.slice(at + 1);
      const corrected = CORRECTED_DOMAINS.get(domain.toLowerCase());

      // The domain is not on the list. That makes it a real provider as far as
      // this rule is concerned — or a misspelling nobody has written down yet,
      // which is a later version of this rule and not a guess made now.
      if (corrected === undefined) {
        continue;
      }

      // Everything but the domain, kept exactly: the padding around the
      // address, and the local part with whatever capitals it arrived with.
      // Those are P10's to fix, and this proposal leaves them where they are so
      // that what changed is one domain and nothing else (1.1.4).
      const leading = previous.slice(0, previous.length - previous.trimStart().length);
      const trailing = previous.slice(leading.length + trimmed.length);
      const next = leading + trimmed.slice(0, at + 1) + corrected + trailing;

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `email`, so the
        // id is only the address of the row — whatever is wrong with the id
        // itself belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'email',
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
