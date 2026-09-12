import { ActionIcon, Code, Group, Table, Text, Tooltip } from '@mantine/core';
import type { RuleDetailRow } from '../api/types';

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
}

/** A value the column did not hold, or does not propose. Dimmed, never blank. */
function Value({ value }: { value: string | null }) {
  if (value === null) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        (none)
      </Text>
    );
  }

  return <Code>{value}</Code>;
}

/**
 * The rows of one section, before and after (1.2.3).
 *
 * Presentational: it decides nothing about what a press does, only what a row
 * looks like and which buttons it carries. It is extracted because it is
 * rendered twice — with actions and without — not on speculation.
 *
 * Two things worth stating:
 *
 * - **The after column reads `ambiguous`, never the absence of `nextValue`.**
 *   An ambiguous rule's rows arrive with no `nextValue` key at all and the
 *   rule's description is what the human reads instead (1.1.12, 1.2.3). A
 *   non-ambiguous rule may legitimately propose null — clearing a column — and
 *   that renders as `(none)`, not as a description.
 * - **The key is `table:legacyId:column`.** With the detail's rule id and
 *   version, which are the same on every row of one section, that is the rule
 *   row's whole primary key, so it cannot repeat inside a section.
 *
 * The rows scroll inside a fixed height rather than being paginated: the
 * endpoint returns every row by design, and a rule with 340 of them must not
 * push the rest of the accordion off the screen.
 */
export function RuleRowsTable({ rows, ambiguous, description, actions }: RuleRowsTableProps) {
  return (
    <Table.ScrollContainer minWidth={640} mah={420} type="native">
      <Table striped highlightOnHover stickyHeader>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Source</Table.Th>
            <Table.Th>Legacy id</Table.Th>
            <Table.Th>Column</Table.Th>
            <Table.Th>Before</Table.Th>
            <Table.Th>{ambiguous ? 'What the rule found' : 'After'}</Table.Th>
            {actions !== undefined && <Table.Th w={100}>Decision</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={`${row.table}:${row.legacyId}:${row.column}`}>
              <Table.Td>
                <Text size="sm">{row.table}</Text>
              </Table.Td>
              <Table.Td>
                <Code>{row.legacyId}</Code>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{row.column}</Text>
              </Table.Td>
              <Table.Td>
                <Value value={row.previousValue} />
              </Table.Td>
              <Table.Td>
                {ambiguous ? (
                  <Text size="sm">{description}</Text>
                ) : (
                  <Value value={row.nextValue ?? null} />
                )}
              </Table.Td>
              {actions !== undefined && (
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
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
