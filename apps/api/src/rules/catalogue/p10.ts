import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P10 — a patient's `email` padded at the ends, or written in capitals.
 *
 * The export notes call this column the primary contact and say one of the
 * later automations used it as a login, so the address is not only printed, it
 * is matched. `" Elena.Vos@Protonmail.Com "` reaches the same mailbox as
 * `"elena.vos@protonmail.com"` and is a different string from it everywhere a
 * string is compared — in a login lookup, in a `WHERE email = ?`, and in D01,
 * which is defined on the *normalised* address and cannot normalise what it
 * only reads. Case and padding are also the one kind of defect an address can
 * carry that costs nothing to remove: no reading of the row is lost, which is
 * what separates this rule from every other `email` entry in the catalogue.
 *
 * Not ambiguous: an address has one normalised form, and this is it.
 *
 * Two things are normalised, and the catalogue names both — "whitespace, or
 * mixed case in the domain", proposing "trimmed and lower-cased":
 *
 * - **The ends are trimmed.** Only the ends. `trim` is the fix the catalogue
 *   names, and it is the only whitespace fix that is certain: a space *inside*
 *   an address — `"willem.ricci @icloud.com"` — leaves a value that is not an
 *   address at all, and closing the gap is a guess about which character the
 *   space replaced. That cell is P12's finding and P12's sentence to the human,
 *   and this rule walks past it rather than half-fixing it.
 * - **The whole address is lower-cased,** local part included, not the domain
 *   alone. The catalogue points at the domain because that is where case is
 *   provably insignificant, but it asks for a value that is "lower-cased"
 *   without qualification, and a shouted address is shouted whole —
 *   `"JAN.JONES@LIVE.NL"`, not `"jan.jones@LIVE.NL"`. Lower-casing the domain
 *   alone would propose `"JAN.JONES@live.nl"`: a value no human wants, in a
 *   column used as a login, where a half-folded address matches nothing the
 *   folded one does not. The standard does reserve case in the local part as
 *   significant; no mailbox provider in this export honours that, and treating
 *   it as significant here would leave the defect unfixed in every row that
 *   has it.
 *
 * Case and padding, and nothing else. The address it proposes may still be a
 * provider typo (P11), may still be a placeholder (P14) — those are their own
 * rules and their own approvals (1.1.4). This one hands them an address whose
 * spelling is no longer hidden behind capitals.
 */

/**
 * A single address, and nothing more complicated than one: text, one `@`, more
 * text, with no whitespace anywhere in it.
 *
 * The gate rather than a validator. This rule does not judge whether an address
 * is real — that it has a domain at all is the whole of what it needs to know,
 * because "mixed case in the domain" presumes there is a domain to lower-case.
 * Three shapes fail it on purpose, and each one belongs to another rule:
 *
 * - no `@`, so no address and no domain — `"n.v.t."`, `"-"`, `"x"`. Lower-casing
 *   those proposes a tidier non-answer, which helps nobody; P12 reports the cell
 *   as what it is.
 * - more than one `@`, or whitespace inside — two addresses crammed into one
 *   cell (P13), or an address with a gap in it (P12). Folding the case of one
 *   half of such a value would propose a cell that is still wrong and now also
 *   inconsistent with itself.
 * - nothing on one side of the `@` — `"noemail@"`. P14 asks the human about the
 *   placeholders, and there is no domain here to normalise.
 */
const SINGLE_ADDRESS = /^[^\s@]+@[^\s@]+$/;

/**
 * The address as it should be stored: ends trimmed, every letter lower case.
 */
function normalised(value: string): string {
  return value.trim().toLowerCase();
}

export const p10: CatalogueRule = {
  ruleId: 'P10',
  version: 1,
  ruleName: 'Patient email has whitespace or capitals',
  description:
    "The patient's email address has whitespace around it, or is written with capital " +
    'letters. The normalised address is proposed — the same address with its ends trimmed ' +
    'and lower-cased, so it matches the mailbox it already reaches, and nothing else about ' +
    'it changed.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every address that
   * would change (1.1.14). Tests `email` and changes `email` (1.1.5), so an
   * approved row stops matching the next time the rules run.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.email;

      // The column holds nothing at all. An empty address is P15's finding —
      // and the notes make that a serious one, since the address was a login —
      // and there is no case or padding here to normalise (1.1.4).
      if (previous === null) {
        continue;
      }

      const trimmed = previous.trim();

      // Nothing but whitespace, so the trim leaves nothing. Proposing an empty
      // address would be proposing the very state P15 asks a human about.
      if (trimmed.length === 0) {
        continue;
      }

      // Not one address, so there is no domain in this cell to lower-case. What
      // is wrong with it is P12's, P13's or P14's, and each of them reports the
      // cell whole rather than after this rule has tidied half of it.
      if (!SINGLE_ADDRESS.test(trimmed)) {
        continue;
      }

      const next = normalised(previous);

      // Nothing to propose when the address is already normalised.
      if (next === previous) {
        continue;
      }

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
