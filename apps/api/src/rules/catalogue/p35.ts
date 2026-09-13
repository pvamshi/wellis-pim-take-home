import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P35 — a patient's `phone` holding a placeholder rather than a number:
 * `"000000000"`, `"123456789"`, and anything else that is all one digit —
 * `"0"`, `"1111111111"`, `"+0000000"`.
 *
 * These are not mistakes, and that is the whole of what makes them worth a
 * rule. Somebody met a field that wanted a phone number, had none to give, and
 * ran a finger down the keypad until the cell looked full. The export notes say
 * this column's "format never enforced", so nothing stopped them and nothing
 * recorded that it had happened. The cost is the one P14 names on `email`: a
 * blank cell is visible to anybody counting blanks, and this cell is not. The
 * row reads as complete from every angle, the appointment reminder is sent, and
 * it rings nowhere — a placeholder is the failure that survives a data-quality
 * report, because it was typed precisely to.
 *
 * Ambiguous, and nothing could make it otherwise. `"000000000"` does not encode
 * a number a better parser could recover; it encodes that nobody wrote one
 * down. Nor does the rest of the row hold it — no combination of a name, a date
 * of birth, a `bsn` and a city spells a telephone number, so there is nothing
 * else here to read, and reading another column to write this one would break
 * 1.1.5 as well. A proposal of the right shape would be an invented number, and
 * an invented number rings on a stranger's handset: this patient's appointment
 * reminder goes to them. So the rule reports and proposes nothing (1.1.12), and
 * its description is the whole of what the human reads.
 *
 * **What is tested is the cell's own shape, not a list of known placeholders.**
 * That is the opposite of the discipline P11, P14 and P38 keep, and the
 * difference is what the test would be claiming. `gmial.com` is a typo and
 * `x@x.x` reaches nobody only because of facts about the world outside the
 * cell, so those rules hold fixed lists and widen them only when somebody has
 * seen a real export. Here there is no such fact: a cell of nine zeroes is one
 * digit nine times over, and that is readable from the cell alone, with nothing
 * assumed about providers, plans or who owns what. So the two shapes are
 * written out as shapes, exactly as the catalogue states them — and both of
 * this column's other rules already hand the first one over as a shape rather
 * than as a string, P33 in as many words ("a placeholder is a placeholder
 * whether it happens to be nine digits long or twenty").
 *
 * **Shape one — one digit, repeated for the whole cell.** The catalogue's "all
 * one digit", which is `"000000000"` as well. Length is not part of it:
 * `"0"`, `"00"`, `"0000000000"` and `"1111111111111111"` are the same cell and
 * the same finding, and P33 says so from its side by refusing to count any of
 * them. Refusing them here on a length of their own would leave `"000"`
 * reported by nobody at all.
 *
 * **Shape two — the keypad run straight through.** The catalogue's
 * `"123456789"`, read as what it is rather than as one exact string:
 * `"1234567890"` is the same sweep with the bottom key included, `"0123456789"`
 * is the same sweep started at it, and `"987654321"` is the same finger going
 * back the other way. Reading only the nine characters the catalogue happens to
 * print would report one of those four and migrate the other three as patients'
 * telephone numbers.
 *
 * Two bounds on that second shape, and both are the shape's own rather than
 * borrowed from another rule:
 *
 * - **At most ten digits.** A run passes each key at most once — a finger goes
 *   along the pad, not round it. So `"12345678901"` is not a sweep; it is a
 *   sweep and then something else, and what that is, this rule cannot say. Ten
 *   is not a threshold picked for tidiness: it is how many digits there are.
 * - **At least seven digits.** Below seven a cell is too short to be a
 *   telephone number anywhere on earth — the shortest complete number in use is
 *   seven once the country code is counted, as in Saint Helena's `+290 xxxx` —
 *   so `"123"` and `"123456"` are fragments, and what is wrong with a fragment
 *   is how many digits are in it, which is P33's question and P33's sentence.
 *   A placeholder is a cell that was made to look like a number; a cell too
 *   short to look like one was never that. P33 reads the same fact about the
 *   world from the same place, and the two rules agreeing about it is not one
 *   of them holding a copy of the other.
 *
 * **A run of one digit needs no such floor, and deliberately.** `"000"` is not
 * a fragment of a longer number somebody stopped typing; it is three presses of
 * one key, which is the same act as nine presses of it. P33 hands every length
 * of it over for exactly that reason, so this rule takes every length.
 *
 * **The cell must already be bare digits, with at most a leading `+`.** That is
 * the shape P30 leaves behind, and it is the same gate P32 and P33 stand
 * behind. `"000 000 000"` is a placeholder with grouping still on it: P30
 * cleans it, and this rule reads what P30 left on the next run. `"000000000
 * ext"` and `"geen"` hold letters and are P34's whole, and a cell with a stray
 * mark in it is nobody's to interpret. Reading through the grouping here would
 * be this rule doing P30's fix silently in order to reach its own test (1.1.4).
 *
 * Left alone, and whose the cells are:
 *
 * - **Any number that is not one of the two shapes.** `"0612345678"` is P32's
 *   country code, `"0031612345678"` is P31's, `"06 12 34 56 78"` is P30's
 *   grouping, `"+31612"` and `"1234567890123456"` are P33's count,
 *   `"06-12345678 ext 12"` is P34's extension. Every one of them is a cell
 *   somebody typed a number into, however badly.
 * - **A number that merely repeats.** `"0612340612"`, `"1212121212"`. A
 *   repeated pair or group is not one digit and not a run, and a real number
 *   can hold either. Calling those placeholders would mean deciding how
 *   patterned a number has to be before nobody believes it, which is a
 *   judgement, not a reading of the cell.
 * - **A number that happens to climb.** `"0612345678"` has `12345678` inside
 *   it and is an ordinary Dutch mobile. The sweep has to be the whole cell, not
 *   a stretch of it, or this rule would report real numbers by the hundred.
 * - **A cell with nothing in it.** `null`, `''`, and a cell of nothing but
 *   whitespace. A placeholder is the opposite of an empty cell — it is the cell
 *   pretending not to be empty — and an empty phone is P36's finding and P36's
 *   sentence.
 *
 * **Two cells carry this finding and P32's proposal at once**, and that is
 * intended rather than tolerated. `"0123456789"` and `"0987654321"` begin with
 * a zero and a digit that is not one, which is P32's trunk zero, so P32
 * proposes `"+3123456789"` on the same run as this rule reports a placeholder.
 * Standing aside for P32 here would be worse than the overlap: the proposal
 * would be approved, the sweep would be gone from the digits, and the
 * placeholder would migrate as a `+31` number nobody can be reached at. The
 * ambiguous finding beside the proposal is precisely the thing that tells the
 * human not to approve it. This is P14's trade rather than P33's — two findings
 * that agree cost a human one extra glance, and a rule holding a copy of
 * another rule's test costs correctness (1.1.1, D3).
 *
 * The column is read and the same column is reported against (1.1.5), which is
 * what makes the rule self-terminating: a human writes the patient's own number
 * into the cell the rule read — or empties it, which is then P36's ordinary
 * empty finding rather than this one — and the row stops matching.
 */

/**
 * A cell holding digits, with a single `+` allowed in front of them and nowhere
 * else. This is the shape P30 leaves behind, and this rule only reads cells
 * that have got that far: a cell with grouping still on it, or a letter, an
 * extension or a stray mark in it, is P30's or P34's exactly as it stands.
 */
const DIGITS_WITH_OPTIONAL_LEADING_PLUS = /^\+?[0-9]+$/;

/**
 * One digit, repeated for the whole cell — the catalogue's "all one digit", and
 * `"000000000"` with it. Every length, because one key pressed three times and
 * one key pressed nine times are the same act.
 */
const ONE_DIGIT_REPEATED = /^([0-9])\1*$/;

/**
 * The longest a keypad run can be: ten, because that is how many keys there
 * are and a finger passes each of them once. An eleventh digit means the cell
 * is a sweep and then something else.
 */
const LONGEST_SWEEP = 10;

/**
 * The shortest complete telephone number in use anywhere — a three-digit
 * country code and a four-digit subscriber number, as in Saint Helena's
 * `+290 xxxx`. Below it a cell is not a number made up, it is a number not
 * finished, and how many digits are in it is P33's question.
 */
const SHORTEST_ANY_NUMBER = 7;

/** How many digits there are, which is what a run wraps round. */
const KEYS = 10;

/** The cell's digits — everything but a leading `+`, which is notation. */
function digitsOf(value: string): string {
  return value.startsWith('+') ? value.slice(1) : value;
}

/**
 * Whether every digit is one step from the one before it, in the given
 * direction. The step is taken round the ten keys, so `9` is followed by `0`
 * going up and `0` is followed by `9` coming down — which is what the person
 * sweeping the pad actually types, and what makes `"1234567890"` the same run
 * as `"0123456789"`.
 */
function stepsBy(direction: number, digits: string): boolean {
  const values = [...digits].map((digit) => Number(digit));

  for (let index = 1; index < values.length; index += 1) {
    if ((values[index - 1] + direction + KEYS) % KEYS !== values[index]) {
      return false;
    }
  }

  return true;
}

/**
 * Whether the whole cell is the keypad run straight through, up or down.
 *
 * The run has to be the whole of the digits and not a stretch inside them —
 * `"0612345678"` holds `12345678` and is somebody's mobile number.
 */
function isKeypadSweep(digits: string): boolean {
  if (digits.length < SHORTEST_ANY_NUMBER || digits.length > LONGEST_SWEEP) {
    return false;
  }

  return stepsBy(1, digits) || stepsBy(-1, digits);
}

export const p35: CatalogueRule = {
  ruleId: 'P35',
  version: 1,
  ruleName: 'Patient phone is a placeholder',
  description:
    "This patient's phone column holds a placeholder rather than a telephone number — one " +
    'digit typed over and over, as in 000000000 or 1111111111, or the keypad run straight ' +
    'through, as in 123456789 or 0987654321. The old form never checked this column, so ' +
    'somebody who had no number to give typed something the length of one and carried on. ' +
    'Nothing is proposed, because there is no number in the cell to recover: these digits ' +
    'say only that the keypad was swept, never who was meant to be reached, and nothing ' +
    'else in the row holds a phone number either — a name, a date of birth and a city ' +
    'identify a person without saying where they can be called. A number invented to fill ' +
    "the cell would be the right shape and would ring on a stranger's handset. What makes " +
    'this worth stopping for is that it does not look like a gap: the row counts as having ' +
    'a phone number, so nobody calling this patient ever finds out why there was no ' +
    'answer. A human supplies the number the patient can actually be reached on, or empties ' +
    'the cell to record that there is none.',
  ambiguous: true,

  /**
   * Reads the whole patient table in one call and returns every `phone` holding
   * a placeholder (1.1.14). Tests `phone` and reports against `phone` (1.1.5),
   * so a row whose human has written the real number — or cleared the cell —
   * stops matching the next time the rules run.
   *
   * `next` is null on every finding, because `ambiguity` is true for the whole
   * response (1.1.12) — the flag is the rule's, never the row's.
   */
  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.phone;

      // No value in the column at all. There is nothing here pretending to be a
      // number, and a row with no phone number is P36's empty finding.
      if (previous === null) {
        continue;
      }

      // Not digits with at most a leading `+`: grouping, padding, a letter, an
      // extension, a stray mark, a `+` in the middle. Reading through those to
      // reach the digits would be this rule quietly doing P30's fix so it could
      // run its own test (1.1.4), so the cell goes to P30 and P34 as it stands
      // and is read here on the run after theirs.
      if (!DIGITS_WITH_OPTIONAL_LEADING_PLUS.test(previous)) {
        continue;
      }

      const digits = digitsOf(previous);

      // One key pressed over and over, or the pad swept from end to end. Either
      // way nobody wrote a number down. Anything else — a real number however
      // badly written, a number that merely repeats, a number with a run inside
      // it — is one of this column's other six rules' business, or nothing's.
      if (!ONE_DIGIT_REPEATED.test(digits) && !isKeypadSweep(digits)) {
        continue;
      }

      updates.push({
        table: 'patient' as const,
        // The row's own legacy id, untouched. This rule tests `phone`, so the
        // id is only the address of the row — whatever is wrong with the id
        // itself belongs to P01 and P02.
        legacyId: patient.legacyPatientId,
        column: 'phone',
        // Reported exactly as stored, so the human sees the cell they would see
        // in the row and can read the digits for themselves.
        prev: previous,
        // No value is proposed, and none can be (1.1.12).
        next: null,
      });
    }

    return { ambiguity: true, updates };
  },
};
