import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P26 — a patient's `bsn` written with spaces, dots or dashes between the
 * digits — `"123 456 789"`, `"123.456.789"`, `"1234-56-789"`. The proposal is
 * the same number with the punctuation gone: the digits alone.
 *
 * The export notes say BSNs "were collected for a period for insurance
 * experiments, then the field was hidden from the form; values were never
 * validated." A form that never validated is a form that took whatever the
 * typist grouped the digits into, and people group nine digits to keep their
 * place — in threes with spaces, in threes with dots, or in the 4-2-3 shape a
 * Dutch form sometimes prints. Every one of those is the same citizen service
 * number, and none of them is a value anything downstream can use: a BSN is
 * nine digits, it is matched digit for digit against an insurer's records, and
 * `"123 456 789"` is a different string from `"123456789"` everywhere a string
 * is compared. Nothing about the person is lost by removing the punctuation,
 * which is what makes this the one `bsn` defect that costs nothing to fix.
 *
 * Not ambiguous. A separator carries no information — it is the typist's
 * grouping, not part of the number — so removing it is reading the cell, not
 * guessing at it. The digits keep their order and their count, and every digit
 * that was in the cell is in the proposal.
 *
 * **Separators, and only separators.** The three the catalogue names:
 *
 * - **Spaces** — any whitespace, because whitespace is one invisible class and
 *   a cell arrives from a spreadsheet with a tab or a non-breaking space in it
 *   as easily as with an ordinary space. A reader cannot tell the three apart
 *   and neither should the rule.
 * - **Dots** — the full stop, the other mark Dutch forms group digits with.
 * - **Dashes** — the hyphen a keyboard types and a CSV carries. A typographic
 *   dash is not read as one: deciding that some unusual character was meant to
 *   be a hyphen is a judgement about what somebody meant, and this rule makes
 *   none. A cell with one in it is left whole for P29 to put in front of a
 *   human.
 *
 * Anything else in the cell and the rule walks past it, whole and untouched:
 *
 * - **A letter, anywhere.** `"12-34X6789"`, `"n.v.t."`, `"onbekend"`. The
 *   catalogue gives letters to P29, which asks a human rather than proposing a
 *   number with a character silently dropped out of the middle of it. Stripping
 *   non-digits indiscriminately is how this rule would turn `"bsn 123456789"`
 *   into a number nobody typed — so it never strips, it removes three named
 *   marks and then checks that what is left is digits.
 * - **Any other mark** — `"123/456789"`, `"123,456,789"`, `"(123)456789"`,
 *   `"+31612345678"`. A slash, a comma, a bracket and a plus are not what the
 *   catalogue named, and each of them hints at a cell holding something other
 *   than a grouped BSN — a date, a decimal, a phone number. P29 reports those
 *   whole.
 * - **A cell that cleans away to nothing** — `"   "`, `"--"`, `"..."`, and an
 *   empty or absent cell. There are no digits here to propose, and a rule whose
 *   fix is "the digits alone" cannot propose an empty `bsn`. A cell with no
 *   nine digits in it is the wrong length after cleaning, which is P29's
 *   finding and P29's sentence to the human.
 *
 * **The count of digits is not this rule's business.** `"1234-5678"` becomes
 * `"12345678"` and stops there: eight digits is a leading zero a spreadsheet
 * ate, which P27 pads, and a length that is neither eight nor nine is P29's.
 * Checking the eleven-proef is P28's. Four rules read this column and each does
 * one thing to it (1.1.4); this one is the first of the four, because it is the
 * one that turns a grouped cell into something the other three can read at all
 * — and P29's own entry says "after cleaning", which presumes the cleaning this
 * rule proposes.
 *
 * **Padding at the ends goes with the separators inside.** The catalogue's word
 * is "inside the number", which describes the mess it names rather than drawing
 * a boundary around the ends: `"  123456789  "` is the same number with the
 * spreadsheet's whitespace still on it, the fix is the same fix, and this
 * column has no whitespace rule of its own the way `legacy_id` has P01. A rule
 * that took the spaces between the digits and left the ones around them would
 * leave a padded BSN with no rule at all, and would leave it padded for P27,
 * P28 and P29 to read.
 *
 * The column is read and the same column is proposed against (1.1.5), and what
 * is proposed is digits with no separator in it, so an approved row does not
 * match the next time the rules run.
 */

/**
 * The three marks the catalogue names, removed wherever they fall — between the
 * digits or around them.
 *
 * `\s` is every whitespace character, which is what makes a tab and a
 * non-breaking space count as the spaces they look like; `.` and `-` are the
 * literal full stop and the literal hyphen, and no other dash.
 *
 * This is a removal, never a filter: it takes out what it names and leaves
 * everything else in place, so a letter or a stray mark survives into the
 * result and fails the digits check below instead of disappearing from a
 * proposed number.
 */
const SEPARATORS = /[\s.-]/g;

/** Digits, at least one, and nothing else. */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * The cell with its spaces, dots and dashes taken out.
 */
function withoutSeparators(value: string): string {
  return value.replace(SEPARATORS, '');
}

export const p26: CatalogueRule = {
  ruleId: 'P26',
  version: 1,
  ruleName: 'Patient bsn has spaces, dots or dashes in it',
  description:
    "This patient's BSN is written with spaces, dots or dashes between the digits — the " +
    'grouping whoever typed it used to keep their place, which the old form never took ' +
    'out. The digits alone are proposed: the same number, in the same order, with the ' +
    'punctuation removed, so it can be compared digit for digit against the number an ' +
    'insurer or a register holds. Nothing about the number itself changes — no digit is ' +
    'added, dropped or reordered — and how many digits there are, and whether they are a ' +
    'valid BSN, are left to the rules that ask those questions.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every BSN that would
   * change (1.1.14). Tests `bsn` and changes `bsn` (1.1.5), and what it
   * proposes holds no separator, so an approved row stops matching the next
   * time the rules run.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.bsn;

      // No value in the column at all. There is nothing here to clean, and a
      // row with no BSN is the wrong length after cleaning, which is P29's.
      if (previous === null) {
        continue;
      }

      const next = withoutSeparators(previous);

      // Nothing but separators — a cell of spaces, a dash somebody typed to
      // mean "none". Removing them leaves no digits to propose, and proposing
      // an empty BSN is not this rule's fix. P29 reports the cell whole.
      if (next.length === 0) {
        continue;
      }

      // Something other than a digit survived the removal: a letter, a slash, a
      // comma, a bracket, a plus, a dash this rule does not read as one. The
      // cell is not a grouped number, so it goes to P29 as it stands rather
      // than being handed on with a character quietly dropped out of it.
      if (!DIGITS_ONLY.test(next)) {
        continue;
      }

      // Already digits and nothing else. Proposing the same value back would be
      // a change with nothing in it put in front of a human, and the row would
      // match again on every run.
      if (next === previous) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `bsn`, so the id
        // is only the address of the row — whatever is wrong with the id itself
        // belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'bsn',
        // Reported exactly as stored, grouping and padding and all, so a human
        // comparing the two sees the cell they would see in the row.
        prev: previous,
        // The digits alone, in the order the cell had them.
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
