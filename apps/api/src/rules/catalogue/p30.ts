import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P30 — a patient's `phone` written with the grouping a person reads a number
 * by: spaces, dots, dashes or brackets — `"06 12 34 56 78"`, `"06-12345678"`,
 * `"+31 6 1234 5678"`, `"(020) 123 4567"`. The proposal is the same number with
 * the grouping gone: the digits, and the leading `+` if the cell had one.
 *
 * The export notes say the phone column's "format never enforced", and a column
 * nobody enforced collects however each person writes a number down. Nobody
 * dials a phone number as one unbroken run of digits; they write it in the
 * pairs, threes and fours they say it in, and the marks between those groups
 * are how a reader keeps their place. Every one of those spellings is the same
 * number, and none of them is a value anything downstream can use: a number is
 * dialled and matched digit for digit, and `"06-12345678"` is a different
 * string from `"0612345678"` everywhere a string is compared.
 *
 * Not ambiguous. A grouping mark carries no information — it is the typist's
 * spacing, not part of the number — so removing it is reading the cell, not
 * guessing at it. The digits keep their order and their count, every digit that
 * was in the cell is in the proposal, and a `+` that was at the front is still
 * at the front.
 *
 * **The grouping, and only the grouping.** The four the catalogue names:
 *
 * - **Spaces** — any whitespace, because whitespace is one invisible class and
 *   a cell arrives from a spreadsheet with a tab or a non-breaking space in it
 *   as easily as with an ordinary space. A reader cannot tell the three apart
 *   and neither should the rule.
 * - **Dots** — the full stop, which is how a number is written in some places
 *   and how a spreadsheet sometimes renders one.
 * - **Dashes** — the hyphen a keyboard types and a CSV carries, which is by
 *   far the commonest mark in this column. A typographic dash is not read as
 *   one: deciding that some unusual character was meant to be a hyphen is a
 *   judgement about what somebody meant, and this rule makes none.
 * - **Brackets** — the round parentheses a person puts round an area code or a
 *   trunk zero, and the square brackets that are the same mark off a different
 *   keyboard. A curly brace is not a mark anybody groups digits with, so a cell
 *   holding one is not a grouped phone number and is left whole.
 *
 * Anything else in the cell and the rule walks past it, whole and untouched:
 *
 * - **A letter, anywhere.** `"06 12345678 tst"`, `"ext 12"`, `"onbekend"`,
 *   `"geen"`. The catalogue gives letters and extensions to P34, which asks a
 *   human rather than proposing a number with a character silently dropped out
 *   of it. Stripping non-digits indiscriminately is how this rule would turn
 *   `"06-12345678 ext 12"` into a thirteen-digit number nobody has — so it
 *   never strips, it removes the marks it names and then checks that what is
 *   left is a phone number's characters.
 * - **Any other mark** — `"06/12345678"`, `"06,12345678"`, `"0612345678?"`.
 *   A slash, a comma and a question mark are not what the catalogue named, and
 *   each hints at a cell holding something other than one grouped number — two
 *   numbers, a note, a doubt about the value. Those go to the phone column's
 *   ambiguous rules as they stand.
 * - **A `+` anywhere but the front, or more than one.** The proposal is "the
 *   digits and any leading `+`", and a cell that does not fit that shape —
 *   `"06+31612345678"`, `"++31612345678"` — is not a number with grouping in
 *   it. Moving a `+` or dropping one of two is a decision about what the cell
 *   meant, and this rule makes none.
 * - **A cell that cleans away to nothing, or to a bare `+`** — `"   "`,
 *   `"()"`, `"--"`, `"+"`, and an empty or absent cell. There are no digits
 *   here to propose, and a rule whose fix is "the digits" cannot propose a
 *   phone number with none in it. An empty cell is P36's finding and a mark
 *   somebody typed instead of a number is P33's or P34's.
 *
 * **What the number means is not this rule's business.** `"06-12345678"`
 * becomes `"0612345678"` and stops there: a national Dutch number wanting its
 * `+31` is P32's fix, a `00` country prefix is P31's, a number too short or too
 * long is P33's, a placeholder is P35's. Seven rules read this column and each
 * does one thing to it (1.1.4); this one is the first of the seven, because it
 * is the one that turns a grouped cell into something the other six can read at
 * all — every one of them is written about digits, and this is what leaves
 * digits behind.
 *
 * **A bracketed trunk zero keeps its zero.** `"+31 (0)6 12345678"` is the
 * international spelling that tells a reader the `0` is dialled at home and
 * dropped abroad, and this rule proposes `"+310612345678"` — the brackets gone,
 * the digit still there. Taking the zero out as well would be a second fix in
 * one rule (1.1.4) and a decision about which of two numbers the cell meant;
 * keeping it loses nothing, because every digit the cell held is still in the
 * proposal and the result is too long for any number, which is exactly what
 * P33 puts in front of a human. This is the same line P26 draws on the `bsn`
 * column: clean the cell, and leave what the digits add up to to the rule that
 * asks.
 *
 * **Padding at the ends goes with the grouping inside.** `"  0612345678  "` is
 * the same number with the spreadsheet's whitespace still on it, the fix is the
 * same fix, and this column has no whitespace rule of its own the way
 * `legacy_id` has P01. A rule that took the spaces between the digits and left
 * the ones around them would leave a padded number with no rule at all, and
 * would leave it padded for P31 through P36 to read.
 *
 * The column is read and the same column is proposed against (1.1.5), and what
 * is proposed holds no grouping mark, so an approved row does not match the
 * next time the rules run.
 */

/**
 * The four marks the catalogue names, removed wherever they fall — between the
 * digits or around them.
 *
 * `\s` is every whitespace character, which is what makes a tab and a
 * non-breaking space count as the spaces they look like; `.` and `-` are the
 * literal full stop and the literal hyphen, and no other dash; `(`, `)`, `[`
 * and `]` are the brackets a person writes round an area code or a trunk zero.
 *
 * This is a removal, never a filter: it takes out what it names and leaves
 * everything else in place, so a letter or a stray mark survives into the
 * result and fails the shape check below instead of disappearing from a
 * proposed number.
 */
const GROUPING = /[\s.()[\]-]/g;

/**
 * What a cleaned phone number may hold and nothing else: at least one digit,
 * with a single `+` allowed in front of them and nowhere else. This is the
 * catalogue's "the digits and any leading `+`", written as a test.
 */
const DIGITS_WITH_OPTIONAL_LEADING_PLUS = /^\+?[0-9]+$/;

/** The cell with its spaces, dots, dashes and brackets taken out. */
function withoutGrouping(value: string): string {
  return value.replace(GROUPING, '');
}

export const p30: CatalogueRule = {
  ruleId: 'P30',
  version: 1,
  ruleName: 'Patient phone has spaces, dots, dashes or brackets in it',
  description:
    "This patient's phone number is written with spaces, dots, dashes or brackets between " +
    'the digits — the grouping whoever typed it used to make the number readable, which ' +
    'the old form never took out. The digits alone are proposed, keeping a leading + if ' +
    'the cell had one: the same number, in the same order, with the punctuation removed, ' +
    'so it can be dialled and compared digit for digit against the number another system ' +
    'holds. Nothing about the number itself changes — no digit is added, dropped or ' +
    'reordered — and whether it is the right length, and whether it needs a country code, ' +
    'are left to the rules that ask those questions.',
  ambiguous: false,

  /**
   * Reads the whole patient table in one call and returns every phone number
   * that would change (1.1.14). Tests `phone` and changes `phone` (1.1.5), and
   * what it proposes holds no grouping mark, so an approved row stops matching
   * the next time the rules run.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.phone;

      // No value in the column at all. There is nothing here to clean, and a
      // row with no phone number is P36's empty finding.
      if (previous === null) {
        continue;
      }

      const next = withoutGrouping(previous);

      // Nothing but grouping — a cell of spaces, a dash somebody typed to mean
      // "none", an empty pair of brackets. Removing them leaves no digits to
      // propose, and proposing an empty phone number is not this rule's fix.
      if (next.length === 0) {
        continue;
      }

      // Something other than a phone number's characters survived the removal:
      // a letter, an extension, a slash, a comma, a dash this rule does not
      // read as one, a `+` that is not at the front or a second one. The cell
      // is not a grouped number, so it goes to this column's ambiguous rules as
      // it stands rather than being handed on with a character quietly dropped
      // out of it.
      if (!DIGITS_WITH_OPTIONAL_LEADING_PLUS.test(next)) {
        continue;
      }

      // Already digits with no grouping in them. Proposing the same value back
      // would be a change with nothing in it put in front of a human, and the
      // row would match again on every run.
      if (next === previous) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `phone`, so the
        // id is only the address of the row — whatever is wrong with the id
        // itself belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'phone',
        // Reported exactly as stored, grouping and padding and all, so a human
        // comparing the two sees the cell they would see in the row.
        prev: previous,
        // The digits in the order the cell had them, with a leading `+` kept.
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
