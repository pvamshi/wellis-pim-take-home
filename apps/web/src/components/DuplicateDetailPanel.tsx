import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Code, Group, Loader, Stack, Table, Text } from '@mantine/core';
import {
  ApiError,
  confirmDuplicate,
  dismissDuplicate,
  duplicateUrl,
  getDuplicateDetail,
} from '../api/client';
import type { DuplicateDetail, DuplicateRowValues } from '../api/types';
import { DiffValue, diffValues, type DiffPiece } from './ValueDiff';

type RequestState =
  | { kind: 'loading' }
  | { kind: 'loaded'; detail: DuplicateDetail }
  | { kind: 'failed'; error: ApiError };

export interface DuplicateDetailPanelProps {
  readonly id: string;
  /**
   * Called after Confirm or Dismiss has landed, with one line saying what it
   * did. The page above shows that line and re-reads its list — the same
   * reason `RowDetailPanel.onChanged` exists: a press here moves this link
   * off the "pending" filter the list defaults to (1.7.4).
   */
  readonly onChanged: (outcome: string) => void;
}

/** The on-screen name for each status (1.7.3). */
const STATUS_LABELS: Record<DuplicateDetail['status'], string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  dismissed: 'Dismissed',
};

const STATUS_COLORS: Record<DuplicateDetail['status'], string> = {
  pending: 'yellow',
  confirmed: 'green',
  dismissed: 'gray',
};

/**
 * X and Y for one column, cut into the runs that differ (1.7.4).
 *
 * The same shape `RuleRowsTable.tsx`'s own `comparison()` gives its non-
 * ambiguous branch: two values present on both sides are diffed character by
 * character; a column held by only one side (safe by construction here — both
 * sides are read off the same legacy entity, so their key sets are always
 * identical, but a value itself can still be null on one side and not the
 * other) is rendered wholly changed rather than diffed against nothing.
 */
function columnDiff(
  x: string | null,
  y: string | null,
): { before: DiffPiece[] | null; after: DiffPiece[] | null } {
  if (x !== null && y !== null) {
    return diffValues(x, y);
  }

  return {
    before: x === null ? null : [{ text: x, changed: true }],
    after: y === null ? null : [{ text: y, changed: true }],
  };
}

/** Every column either side holds, in the order the canonical row lists them. */
function columnsOf(values: DuplicateRowValues): string[] {
  return Object.keys(values);
}

/**
 * One expanded duplicate link (1.7.4): X and Y side by side, every column,
 * and Confirm / Dismiss while the link is still pending (1.7.5, 1.7.6).
 *
 * `RowDetailPanel`'s counterpart for this screen: it reads on mount (and is
 * mounted by being expanded), the screen's truth always comes from re-reading
 * after a press, and a failed press changes nothing on the screen.
 */
export function DuplicateDetailPanel({ id, onChanged }: DuplicateDetailPanelProps) {
  const [state, setState] = useState<RequestState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiError | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    // Every rejection is handled here, so nothing escapes as an unhandled
    // promise rejection: a backend that is not running renders the Alert
    // below.
    getDuplicateDetail(id, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'loaded', detail });
      })
      .catch((cause: unknown) => {
        // An abort means this panel was collapsed; there is no one to tell.
        if (controller.signal.aborted) return;
        setState({
          kind: 'failed',
          error: cause instanceof ApiError ? cause : new ApiError(String(cause), null, duplicateUrl(id)),
        });
      });

    return () => controller.abort();
  }, [id, attempt]);

  /**
   * Runs Confirm or Dismiss, then re-reads the detail.
   *
   * The re-read is the point: it is what moves `status` from `pending` to
   * whatever the press landed as, which is what swaps the buttons below for
   * the settled sentence. A press that fails leaves the screen exactly as it
   * was.
   */
  function press(run: () => Promise<string>) {
    setBusy(true);
    setActionError(null);

    run()
      .then((outcome) => {
        setAttempt((n) => n + 1);
        onChanged(outcome);
      })
      .catch((cause: unknown) => {
        setActionError(
          cause instanceof ApiError ? cause : new ApiError(String(cause), null, duplicateUrl(id)),
        );
      })
      .finally(() => setBusy(false));
  }

  if (state.kind === 'loading') {
    return (
      <Group gap="sm">
        <Loader size="sm" />
        <Text size="sm">
          Reading <Code>{duplicateUrl(id)}</Code>
        </Text>
      </Group>
    );
  }

  if (state.kind === 'failed') {
    return (
      <Alert color="red" title="This link could not be read">
        <Stack gap="xs">
          <Text size="sm">{state.error.message}</Text>
          {state.error.status !== null && <Text size="sm">HTTP status: {state.error.status}</Text>}
          <Text size="sm">
            URL tried: <Code>{state.error.url}</Code>
          </Text>
          <Group>
            <Button
              color="red"
              variant="light"
              onClick={() => {
                setState({ kind: 'loading' });
                setAttempt((n) => n + 1);
              }}
            >
              Retry
            </Button>
          </Group>
        </Stack>
      </Alert>
    );
  }

  const { detail } = state;
  const columns = columnsOf(detail.canonical.values);

  function onConfirm() {
    const x = detail.duplicate.legacyId;
    const y = detail.canonical.legacyId;

    press(async () => {
      const report = await confirmDuplicate(id);
      return report.rejected
        ? `Confirmed: ${x} is a duplicate of ${y}. ${x} was Import rejected, its reason naming ${y} and ${detail.ruleName} (1.7.5).`
        : `Confirmed: ${x} is a duplicate of ${y}. Neither row was rejected — they share one legacy id (1.7.5).`;
    });
  }

  function onDismiss() {
    const x = detail.duplicate.legacyId;
    const y = detail.canonical.legacyId;

    press(async () => {
      await dismissDuplicate(id);
      return `Dismissed the link between ${x} and ${y}. It will not be recorded again (1.7.2).`;
    });
  }

  return (
    <Stack gap="lg">
      {actionError !== null && (
        <Alert color="red" title="That press did not land">
          <Stack gap="xs">
            <Text size="sm">{actionError.message}</Text>
            {actionError.status !== null && <Text size="sm">HTTP status: {actionError.status}</Text>}
            <Text size="sm">
              URL tried: <Code>{actionError.url}</Code>
            </Text>
            <Text size="sm">Nothing was decided. What is below is unchanged.</Text>
          </Stack>
        </Alert>
      )}

      <Group gap="xs">
        <Text fw={600}>{detail.ruleName}</Text>
        <Text size="sm" c="dimmed">
          v{detail.version}
        </Text>
      </Group>

      <Table.ScrollContainer minWidth={480}>
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Column</Table.Th>
              <Table.Th>X — {detail.duplicate.legacyId}</Table.Th>
              <Table.Th>Y — {detail.canonical.legacyId}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {columns.map((column) => {
              const { before, after } = columnDiff(
                detail.duplicate.values[column] ?? null,
                detail.canonical.values[column] ?? null,
              );

              return (
                <Table.Tr key={column}>
                  <Table.Td>
                    <Text size="sm">{column}</Text>
                  </Table.Td>
                  <Table.Td>
                    <DiffValue pieces={before} tone="removed" />
                  </Table.Td>
                  <Table.Td>
                    <DiffValue pieces={after} tone="added" />
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
          {/*
            The glyphs need saying once, the same reason `RuleRowsTable`
            carries this caption: without it a reader meets `·` in a red
            highlight and has to guess whether it stood for a space or
            nothing at all.
          */}
          <Table.Caption>
            <Text size="xs" c="dimmed">
              · space → tab ↵ newline ⟨U+…⟩ any other invisible character
            </Text>
          </Table.Caption>
        </Table>
      </Table.ScrollContainer>

      <Group align="center">
        {detail.status === 'pending' && (
          <>
            <Button color="green" onClick={onConfirm} disabled={busy}>
              Confirm
            </Button>
            <Button color="red" variant="light" onClick={onDismiss} disabled={busy}>
              Dismiss
            </Button>
            {busy && <Loader size="sm" />}
          </>
        )}
        {detail.status !== 'pending' && (
          <Group gap="xs">
            <Badge variant="light" color={STATUS_COLORS[detail.status]}>
              {STATUS_LABELS[detail.status]}
            </Badge>
            <Text size="sm" c="dimmed">
              {/* Both end states are final (1.7.3) — there is nothing left to press. */}
              This link is {detail.status} and cannot be changed.
            </Text>
          </Group>
        )}
      </Group>
    </Stack>
  );
}
