import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ActionIcon,
  Button,
  Code,
  Group,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import type { RuleDetailRow } from '../api/types';
import { DiffValue, diffValues, type DiffPiece } from './ValueDiff';

/**
 * The tick and the cross for one row (1.2.4, 1.2.7), or nothing.
 *
 * Optional because the same table renders both sections: pending rows carry
 * both buttons, approved rows carry neither. An approved row is settled —
 * acceptance is final (1.2.11, `deferred.md` D2) and the backend moves only
 * rows that are still pending — so a button there would be a no-op that lies
 * about what the screen can do.
 */
export interface RuleRowActions {
  readonly onApprove: (row: RuleDetailRow) => void;
  readonly onDecline: (row: RuleDetailRow) => void;
  /**
   * The two presses an ambiguous rule's row carries instead of the tick and the
   * cross (1.1.12).
   *
   * A rule that proposes nothing leaves the tick with nothing to apply, so the
   * row asks the human for the value instead and applies what they type down
   * the same path. The cross becomes a box and a button rather than a dialog,
   * because on a row nobody can propose a value for, why it was waved through
   * is the only thing there is to record.
   *
   * `onDecline` above is still reached, from the "rule needs revision" press:
   * that one opens the dialog, which is where the tick that parks the whole
   * version lives (1.2.8).
   *
   * Two boxes and no more: the value to write, and the reason to leave it. The
   * rule's own description already says what is wrong with the row, so the
   * value is the answer and nothing else is asked for.
   */
  readonly onApproveWithValue: (row: RuleDetailRow, value: string) => void;
  readonly onDeclineWithReason: (row: RuleDetailRow, reason: string) => void;
  /** True while a press is in flight: every button is disabled until it lands. */
  readonly busy: boolean;
}

export interface RuleRowsTableProps {
  readonly rows: RuleDetailRow[];
  /** The rule's, not the row's (1.1.12). Decides what the after column shows. */
  readonly ambiguous: boolean;
  /** The rule's description, which is what an ambiguous rule shows (1.2.3). */
  readonly description: string;
  readonly actions?: RuleRowActions;
  /** Drops the Source and Legacy id columns, for a table already inside one row's own panel. */
  readonly hideRowIdentity?: boolean;
}

/**
 * The two sides of one row, cut into the runs that changed and the runs that
 * did not.
 *
 * Only a row with a value on both sides is compared. Everything else has no
 * counterpart to compare against — a column being filled in for the first time,
 * or a rule proposing that a column be cleared — so the value is wholly added
 * or wholly removed, which is what marking it all changed says.
 *
 * An ambiguous rule proposes nothing at all (1.1.12), so it has a before and no
 * after; what it found is written across the full width below the row instead
 * (1.2.3).
 */
function comparison(
  row: RuleDetailRow,
  ambiguous: boolean,
): { before: DiffPiece[] | null; after: DiffPiece[] | null } {
  const previous = row.previousValue;

  if (ambiguous) {
    return { before: previous === null ? null : [{ text: previous, changed: false }], after: null };
  }

  const next = row.nextValue ?? null;

  if (previous !== null && next !== null) {
    return diffValues(previous, next);
  }

  return {
    before: previous === null ? null : [{ text: previous, changed: true }],
    after: next === null ? null : [{ text: next, changed: true }],
  };
}

/** A row's address as one string, which is also its React key. */
function keyOf(row: RuleDetailRow): string {
  return `${row.table}:${row.legacyId}:${row.column}`;
}

/**
 * The value box and the reason box for one ambiguous row.
 *
 * Local state, and deliberately: a half-typed value is not a decision, so it
 * belongs to the input that holds it and to nothing above. One instance per
 * row, keyed by the row's address on the `<tr>`, so React cannot carry what was
 * typed on one row over to another when the list is re-read.
 *
 * The value box starts at what the column holds now. The human is nearly always
 * correcting a value rather than inventing one — a date read the wrong way
 * round, a weight with the unit typed into it — and starting from the current
 * cell means they edit the part that is wrong instead of retyping the rest of
 * it. It is a text box, not a dropdown or a date picker: every legacy column is
 * text, and what is right for a `dob` is not what is right for a `phone`.
 */
function AmbiguousRowActions({ row, actions }: { row: RuleDetailRow; actions: RuleRowActions }) {
  const [value, setValue] = useState(row.previousValue ?? '');
  const [reason, setReason] = useState('');

  return (
    <Stack gap={6}>
      <Group gap={6} wrap="nowrap" align="flex-start">
        <TextInput
          size="xs"
          w={200}
          value={value}
          placeholder="What this column should hold"
          aria-label={`Value for ${row.table} ${row.legacyId} ${row.column}`}
          disabled={actions.busy}
          onChange={(event) => setValue(event.currentTarget.value)}
        />
        <Button
          size="xs"
          color="green"
          disabled={actions.busy}
          onClick={() => actions.onApproveWithValue(row, value)}
        >
          Update
        </Button>
      </Group>
      <Group gap={6} wrap="nowrap" align="flex-start">
        <TextInput
          size="xs"
          w={200}
          value={reason}
          placeholder="Why leave it (optional)"
          aria-label={`Reason for declining ${row.table} ${row.legacyId} ${row.column}`}
          disabled={actions.busy}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
        <Button
          size="xs"
          variant="light"
          color="red"
          disabled={actions.busy}
          onClick={() => actions.onDeclineWithReason(row, reason)}
        >
          Decline
        </Button>
      </Group>
      {/*
        The one press that still needs the dialog. An ambiguous rule that is
        asking the wrong question is a rule to revise, not a row to answer, and
        the tick that parks the whole version (1.2.8) lives in the dialog the
        cross opens.
      */}
      <Button
        size="compact-xs"
        variant="subtle"
        color="gray"
        disabled={actions.busy}
        onClick={() => actions.onDecline(row)}
      >
        The rule itself is wrong
      </Button>
    </Stack>
  );
}

/**
 * The rows of one section, before and after (1.2.3).
 *
 * Presentational: it decides nothing about what a press does, only what a row
 * looks like and which buttons it carries. It is extracted because it is
 * rendered twice — with actions and without — not on speculation.
 *
 * Three things worth stating:
 *
 * - **The after column reads `ambiguous`, never the absence of `nextValue`.**
 *   An ambiguous rule's rows arrive with no `nextValue` key at all and the
 *   rule's description is what the human reads instead (1.1.12, 1.2.3). A
 *   non-ambiguous rule may legitimately propose null — clearing a column — and
 *   that renders as `(none)`, not as a description.
 * - **The decision column is two different things.** A rule that proposes a
 *   value gets the tick and the cross; a rule that cannot gets a box to type
 *   the value into, because a tick with nothing to apply is a button that can
 *   only fail.
 * - **The key is `table:legacyId:column`.** With the detail's rule id and
 *   version, which are the same on every row of one section, that is the rule
 *   row's whole primary key, so it cannot repeat inside a section.
 *
 * The rows scroll inside a fixed height rather than being paginated: the
 * endpoint returns every row by design, and a rule with 340 of them must not
 * push the rest of the accordion off the screen.
 */
/**
 * The full-width cell under an ambiguous row. Pulled up against the row above
 * by having no top border of its own, so the two read as one entry rather than
 * as two rows that happen to be adjacent.
 */
const FOUND_CELL: CSSProperties = {
  borderTop: 'none',
  paddingTop: 0,
  color: 'var(--mantine-color-dimmed)',
};

/** How tall a row is assumed to be before it has been measured. */
const ESTIMATED_ROW_HEIGHT = 56;

/** How much of the list is drawn. The virtualiser needs a scroll box to own. */
const LIST_HEIGHT = 420;

export function RuleRowsTable({
  rows,
  ambiguous,
  description,
  actions,
  hideRowIdentity = false,
}: RuleRowsTableProps) {
  // Source and legacy id (unless hidden), column and before, plus after on a
  // rule that proposes one and the decision column when the section is
  // actionable. The full-width cell below each ambiguous row spans exactly these.
  const columnCount =
    (hideRowIdentity ? 2 : 4) + (ambiguous ? 0 : 1) + (actions === undefined ? 0 : 1);

  /**
   * Only the rows on screen are drawn.
   *
   * A rule can have thousands of findings — one on this catalogue has 2911 —
   * and every one of them used to be in the DOM, several hundred nodes apiece,
   * behind a 420-pixel window showing eight. The scroll box was already here;
   * what is new is that what it scrolls over is mostly empty space.
   *
   * One `<tbody>` per row rather than one `<tr>`, which is what makes this work
   * on an ambiguous rule: there a row is a `<tr>` and the full-width finding
   * below it, and a ref cannot be put on the fragment holding both. A table may
   * have any number of `<tbody>` elements, so each becomes the one element the
   * virtualiser measures — and it measures rather than estimating, because a
   * row carrying two input boxes is several times the height of one that does
   * not.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 6,
  });

  const visible = virtualizer.getVirtualItems();
  const above = visible.length > 0 ? visible[0].start : 0;
  const below =
    visible.length > 0 ? virtualizer.getTotalSize() - visible[visible.length - 1].end : 0;

  return (
    <div ref={scrollRef} style={{ maxHeight: LIST_HEIGHT, overflow: 'auto' }}>
      {/*
        Not striped when a rule is ambiguous: an entry is two rows there, and
        the zebra would shade the row and the finding below it differently —
        making one entry look like two, which is the opposite of what the second
        row is for.
      */}
      <Table striped={!ambiguous} highlightOnHover stickyHeader>
        <Table.Thead>
          <Table.Tr>
            {!hideRowIdentity && <Table.Th>Source</Table.Th>}
            {!hideRowIdentity && <Table.Th>Legacy id</Table.Th>}
            <Table.Th>Column</Table.Th>
            <Table.Th>Before</Table.Th>
            {/*
              An ambiguous rule has no after value, and what it found goes in a
              full-width row of its own below each row rather than in a column
              here — a column would take its width from `Before`, which is the
              one thing on the row that has to be readable.
            */}
            {!ambiguous && <Table.Th>After</Table.Th>}
            {actions !== undefined && (
              <Table.Th w={ambiguous ? 280 : 100}>
                {ambiguous ? 'What should it be?' : 'Decision'}
              </Table.Th>
            )}
          </Table.Tr>
        </Table.Thead>
        {above > 0 && (
          <Table.Tbody>
            <Table.Tr>
              <Table.Td
                colSpan={columnCount}
                style={{ height: above, padding: 0, border: 'none' }}
              />
            </Table.Tr>
          </Table.Tbody>
        )}
        {visible.map((item) => {
          const row = rows[item.index];

          return (
            <Table.Tbody key={keyOf(row)} ref={virtualizer.measureElement} data-index={item.index}>
              {(() => {
                const { before, after } = comparison(row, ambiguous);

                return (
                  <>
                    <Table.Tr>
                      {!hideRowIdentity && (
                        <Table.Td>
                          <Text size="sm">{row.table}</Text>
                        </Table.Td>
                      )}
                      {!hideRowIdentity && (
                        <Table.Td>
                          <Code>{row.legacyId}</Code>
                        </Table.Td>
                      )}
                      <Table.Td>
                        <Text size="sm">{row.column}</Text>
                      </Table.Td>
                      <Table.Td>
                        <DiffValue pieces={before} tone={ambiguous ? 'plain' : 'removed'} />
                      </Table.Td>
                      {!ambiguous && (
                        <Table.Td>
                          <DiffValue pieces={after} tone="added" />
                        </Table.Td>
                      )}
                      {actions !== undefined && ambiguous && (
                        <Table.Td>
                          <AmbiguousRowActions row={row} actions={actions} />
                        </Table.Td>
                      )}
                      {actions !== undefined && !ambiguous && (
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap">
                            {/*
                      Glyphs rather than an icon component: no icon package is
                      installed and tech-stack §4.1 names none, so one is not
                      introduced for two buttons. The aria-label is what a
                      screen reader reads, since the glyph is decoration.
                    */}
                            <Tooltip label="Approve this row" withArrow>
                              <ActionIcon
                                variant="light"
                                color="green"
                                aria-label={`Approve ${row.table} ${row.legacyId} ${row.column}`}
                                disabled={actions.busy}
                                onClick={() => actions.onApprove(row)}
                              >
                                ✓
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Decline this row" withArrow>
                              <ActionIcon
                                variant="light"
                                color="red"
                                aria-label={`Decline ${row.table} ${row.legacyId} ${row.column}`}
                                disabled={actions.busy}
                                onClick={() => actions.onDecline(row)}
                              >
                                ✕
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      )}
                    </Table.Tr>
                    {ambiguous && (
                      <Table.Tr>
                        <Table.Td colSpan={columnCount} style={FOUND_CELL}>
                          <Text size="sm">{description}</Text>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </>
                );
              })()}
            </Table.Tbody>
          );
        })}
        {below > 0 && (
          <Table.Tbody>
            <Table.Tr>
              <Table.Td
                colSpan={columnCount}
                style={{ height: below, padding: 0, border: 'none' }}
              />
            </Table.Tr>
          </Table.Tbody>
        )}
        {/*
          The glyphs need saying once. Without this a reader meets `·` in a red
          highlight and has to guess whether the old value contained a dot or a
          space — which would put the legend's absence in the way of the very
          thing it is drawn to show.
        */}
        <Table.Caption>
          <Text size="xs" c="dimmed">
            · space → tab ↵ newline ⟨U+…⟩ any other invisible character
          </Text>
        </Table.Caption>
      </Table>
    </div>
  );
}
