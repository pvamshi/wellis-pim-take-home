import type { CSSProperties, ReactNode } from 'react';
import { Text } from '@mantine/core';

/**
 * Before and after, rendered so the change is visible (1.2.3).
 *
 * Two problems with printing the two values as plain text, both of which this
 * file exists to fix:
 *
 * - **Most of these rules change characters you cannot see.** P01 trims
 *   whitespace, P30 takes the spaces and dashes out of a phone number, P03
 *   collapses a doubled space inside a name. `"Jan  van der Berg"` and
 *   `"Jan van der Berg"` are the same picture on screen, so a human approving
 *   the change is approving something they were never shown. Every character
 *   that has no glyph of its own gets one here.
 * - **Nothing said which part changed.** A forty-character value with one
 *   altered digit made the reader diff it themselves. The changed run is
 *   highlighted on both sides.
 *
 * Red for what the column holds now, green for what the rule proposes, the way
 * a diff is read everywhere else.
 */

/** One run of characters that either survived the change, or did not. */
export interface DiffPiece {
  readonly text: string;
  readonly changed: boolean;
}

export interface ValueDiff {
  readonly before: DiffPiece[];
  readonly after: DiffPiece[];
}

/**
 * Above this many characters the two values are marked wholly changed instead
 * of being compared.
 *
 * The comparison below costs one cell per pair of characters, and these are
 * field values — a name, an email, a phone number, a date. Anything past a
 * couple of hundred characters is a cell holding something that is not the
 * field at all, where a character-level diff would be noise anyway.
 */
const MAX_COMPARED = 256;

/** Appends a character, extending the last run when it is of the same kind. */
function push(pieces: DiffPiece[], text: string, changed: boolean): void {
  const last = pieces[pieces.length - 1];

  if (last !== undefined && last.changed === changed) {
    pieces[pieces.length - 1] = { text: last.text + text, changed };
    return;
  }

  pieces.push({ text, changed });
}

/**
 * Splits both values into runs, by longest common subsequence.
 *
 * What the two strings have in common is unchanged; everything else is a
 * removal on the left or an addition on the right. A subsequence rather than a
 * common prefix and suffix because the commonest change in this catalogue is
 * padding: comparing `"  P-0310  "` with `"P-0310"` by prefix finds nothing in
 * common at all, and would paint the whole value red when four spaces are the
 * whole of the change.
 */
export function diffValues(before: string, after: string): ValueDiff {
  if (before.length > MAX_COMPARED || after.length > MAX_COMPARED) {
    return {
      before: before.length > 0 ? [{ text: before, changed: true }] : [],
      after: after.length > 0 ? [{ text: after, changed: true }] : [],
    };
  }

  const left = Array.from(before);
  const right = Array.from(after);
  const rows = left.length;
  const columns = right.length;
  const width = columns + 1;

  // lengths[i][j] is the length of the longest common subsequence of left[i..]
  // and right[j..]. Filled from the end so the walk below can read it forwards.
  const lengths = new Uint16Array((rows + 1) * width);

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        left[i] === right[j]
          ? lengths[(i + 1) * width + (j + 1)] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + (j + 1)]);
    }
  }

  const beforePieces: DiffPiece[] = [];
  const afterPieces: DiffPiece[] = [];
  let i = 0;
  let j = 0;

  while (i < rows && j < columns) {
    if (left[i] === right[j]) {
      push(beforePieces, left[i], false);
      push(afterPieces, right[j], false);
      i += 1;
      j += 1;
      continue;
    }

    // Ties go to the removal, so a run of removals and the additions replacing
    // it come out grouped rather than interleaved character by character.
    if (lengths[(i + 1) * width + j] >= lengths[i * width + (j + 1)]) {
      push(beforePieces, left[i], true);
      i += 1;
      continue;
    }

    push(afterPieces, right[j], true);
    j += 1;
  }

  for (; i < rows; i += 1) {
    push(beforePieces, left[i], true);
  }

  for (; j < columns; j += 1) {
    push(afterPieces, right[j], true);
  }

  return { before: beforePieces, after: afterPieces };
}

/**
 * The glyph standing in for a character that has none, or null for a character
 * that draws itself.
 *
 * The three that appear in this data constantly get a mark a reader recognises.
 * Everything else invisible — a non-breaking space pasted out of a document, a
 * zero-width space, a control character — is printed as its code point, because
 * naming it is the only way to tell two things apart that look identical and
 * compare unequal.
 */
function glyphFor(character: string): string | null {
  if (character === ' ') return '·';
  if (character === '\t') return '→';
  if (character === '\n') return '↵';

  const code = character.codePointAt(0) ?? 0;
  const invisible =
    /\s/.test(character) ||
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x00ad ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0xfeff;

  return invisible ? `⟨U+${code.toString(16).toUpperCase().padStart(4, '0')}⟩` : null;
}

const GLYPH: CSSProperties = {
  opacity: 0.55,
  fontWeight: 600,
};

/**
 * One run of characters, with the invisible ones drawn.
 *
 * An ordinary space is only marked inside a changed run, or where it pads the
 * ends of the value. Marking every space would turn `Jan van der Berg` into
 * `Jan·van·der·Berg` on every row, which buries the one space that matters
 * under the four that do not — and padding and a changed space are exactly the
 * two cases a reader cannot otherwise see. Everything else invisible is always
 * marked, wherever it falls: a non-breaking space in a run of ordinary ones is
 * invisible precisely because nothing around it looks different.
 */
function characters(
  text: string,
  from: number,
  changed: boolean,
  leading: number,
  trailing: number,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let plain = '';
  let at = from;

  const flush = () => {
    if (plain.length > 0) {
      nodes.push(plain);
      plain = '';
    }
  };

  for (const character of text) {
    const glyph = glyphFor(character);
    const padding = at < leading || at >= trailing;

    if (glyph === null || (character === ' ' && !changed && !padding)) {
      plain += character;
      at += character.length;
      continue;
    }

    flush();
    nodes.push(
      <span key={at} style={GLYPH}>
        {glyph}
      </span>,
    );
    at += character.length;
  }

  flush();
  return nodes;
}

type Tone = 'removed' | 'added' | 'plain';

const TONES: Record<Tone, { field: CSSProperties; changed: CSSProperties }> = {
  removed: {
    field: {
      background: 'light-dark(var(--mantine-color-red-0), rgba(224, 49, 49, 0.10))',
      border: '1px solid light-dark(var(--mantine-color-red-1), rgba(224, 49, 49, 0.25))',
    },
    changed: {
      background: 'light-dark(var(--mantine-color-red-2), rgba(224, 49, 49, 0.42))',
    },
  },
  added: {
    field: {
      background: 'light-dark(var(--mantine-color-green-0), rgba(43, 138, 62, 0.10))',
      border: '1px solid light-dark(var(--mantine-color-green-1), rgba(43, 138, 62, 0.25))',
    },
    changed: {
      background: 'light-dark(var(--mantine-color-green-2), rgba(43, 138, 62, 0.42))',
    },
  },
  // An ambiguous rule proposes nothing, so its before value is not being
  // removed and must not be painted as though it were. It still gets its
  // invisible characters drawn — that is often the whole of what is wrong
  // with it.
  plain: {
    field: {
      background: 'var(--mantine-color-default-hover)',
      border: '1px solid var(--mantine-color-default-border)',
    },
    changed: {},
  },
};

const FIELD: CSSProperties = {
  display: 'inline-block',
  maxWidth: '100%',
  padding: '2px 6px',
  borderRadius: 'var(--mantine-radius-sm)',
  fontFamily: 'var(--mantine-font-family-monospace)',
  fontSize: 'var(--mantine-font-size-sm)',
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};

const CHANGED: CSSProperties = {
  borderRadius: 2,
};

export interface DiffValueProps {
  /**
   * The runs from `diffValues`, or null when the column holds nothing at all.
   *
   * Null is not the empty string here and is not drawn as one: "this column was
   * never filled in" and "this column holds an empty string" are different
   * findings, and several rules in the catalogue turn on which it is.
   */
  readonly pieces: DiffPiece[] | null;
  readonly tone: Tone;
}

/** One side of the comparison — what the column holds, or what is proposed. */
export function DiffValue({ pieces, tone }: DiffValueProps) {
  if (pieces === null) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        (none)
      </Text>
    );
  }

  const whole = pieces.map((piece) => piece.text).join('');

  if (whole.length === 0) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        (empty)
      </Text>
    );
  }

  const leading = whole.length - whole.trimStart().length;
  const trailing = whole.trimEnd().length;
  const colours = TONES[tone];
  let at = 0;

  return (
    <span style={{ ...FIELD, ...colours.field }}>
      {pieces.map((piece) => {
        const from = at;
        at += piece.text.length;

        return (
          <span key={from} style={piece.changed ? { ...CHANGED, ...colours.changed } : undefined}>
            {characters(piece.text, from, piece.changed, leading, trailing)}
          </span>
        );
      })}
    </span>
  );
}
