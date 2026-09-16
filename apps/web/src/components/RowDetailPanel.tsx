import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Stack, Table, Text, TextInput } from '@mantine/core';
import {
  ApiError,
  approveAllOnRow,
  approveRow,
  declineAllOnRow,
  declineRow,
  editRow,
  getRowDetail,
  rejectRow,
  reviseFromRow,
  rowUrl,
  unrejectRow,
} from '../api/client';
import type {
  LegacySourceTable,
  RowDetailFinding,
  RowDetailResponse,
  RowDetailRuleGroup,
  RowDetailSettledFinding,
  RowRejectionReport,
  RuleDetailRow,
  RuleRowAddress,
} from '../api/types';
import { DeclineDialog, type DeclineDecision } from './DeclineDialog';
import { ReasonDialog } from './ReasonDialog';
import { RuleRowsTable } from './RuleRowsTable';
import { DiffValue, diffValues, type DiffPiece } from './ValueDiff';

type RequestState =
  | { kind: 'loading' }
  | { kind: 'loaded'; detail: RowDetailResponse }
  | { kind: 'failed'; error: ApiError };

/**
 * The finding cross waiting on `DeclineDialog`. The rule id travels with it
 * because a row's findings can span several rules and versions at once.
 */
interface DeclineTarget {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly row: RuleDetailRow;
  readonly address: RuleRowAddress;
}

/** The field being edited inline, and what has been typed so far. */
interface Editing {
  readonly column: string;
  readonly value: string;
  /** Why it is being changed. Required: nothing saves while it is blank. */
  readonly note: string;
}

export interface RowDetailPanelProps {
  readonly table: LegacySourceTable;
  readonly legacyId: string;
  /**
   * Whether the list showed this row as rejected when it was expanded. The
   * detail endpoint carries no rejection field (1.6.2), so this seeds the
   * panel's own state, which each press's report then keeps current.
   */
  readonly initialRejected: boolean;
  /** Whether the list showed this row as Imported (2.6): final, so read-only. */
  readonly imported: boolean;
  /** Called after a press has landed, with one line saying what it did; the page re-reads its list. */
  readonly onChanged: (outcome: string) => void;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** One finding in the rules screen's row shape, so `RuleRowsTable` draws it unchanged. */
function toRuleDetailRow(
  table: LegacySourceTable,
  legacyId: string,
  finding: RowDetailFinding,
): RuleDetailRow {
  return {
    table,
    legacyId,
    column: finding.column,
    previousValue: finding.previousValue,
    nextValue: finding.nextValue,
  };
}

/** One resolved problem on the row's log. */
interface LogEntry extends RowDetailSettledFinding {
  readonly key: string;
  readonly ruleName: string;
}

/** Both sides of a log line: compared when both hold a value, otherwise wholly one side. */
function logPieces(entry: LogEntry): { before: DiffPiece[] | null; after: DiffPiece[] | null } {
  const { previousValue: before, nextValue: after } = entry;

  if (before !== null && after !== null) return diffValues(before, after);

  return {
    before: before === null ? null : [{ text: before, changed: true }],
    after: after === null ? null : [{ text: after, changed: true }],
  };
}

/**
 * One expanded row (1.6.3–1.6.7), laid out as a record page: a status line
 * with the row's actions, its values as a field/value table edited inline, its
 * open problems grouped by rule, and a log of the problems already resolved.
 *
 * Row-wide presses that settle many things at once (Decline all, Reject) ask
 * for confirmation and an optional reason in a dialog; nothing is a
 * permanently open form. A rejected or imported row is read-only.
 */
export function RowDetailPanel({
  table,
  legacyId,
  initialRejected,
  imported,
  onChanged,
}: RowDetailPanelProps) {
  const [state, setState] = useState<RequestState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<DeclineTarget | null>(null);
  const [dialog, setDialog] = useState<'declineAll' | 'reject' | null>(null);
  const [rejected, setRejected] = useState(initialRejected);
  const [editing, setEditing] = useState<Editing | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    getRowDetail(table, legacyId, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'loaded', detail });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: 'failed',
          error:
            cause instanceof ApiError
              ? cause
              : new ApiError(String(cause), null, rowUrl(table, legacyId)),
        });
      });

    return () => controller.abort();
  }, [table, legacyId, attempt]);

  function fail(cause: unknown) {
    setActionError(cause instanceof ApiError ? cause.message : String(cause));
  }

  /** Runs a press that changes findings or values, then re-reads the detail. A failed press changes nothing on screen. */
  function press(run: () => Promise<string>, after?: () => void) {
    setBusy(true);
    setActionError(null);

    run()
      .then((outcome) => {
        after?.();
        setAttempt((n) => n + 1);
        onChanged(outcome);
      })
      .catch(fail)
      .finally(() => setBusy(false));
  }

  /** Reject and un-reject change neither findings nor values, so the report updates local state instead of a re-read. */
  function pressRejection(run: () => Promise<RowRejectionReport>, outcome: string) {
    setBusy(true);
    setActionError(null);

    run()
      .then((report) => {
        setRejected(report.rejected);
        setEditing(null);
        onChanged(outcome);
      })
      .catch(fail)
      .finally(() => setBusy(false));
  }

  function addressOf(group: RowDetailRuleGroup, row: RuleDetailRow): RuleRowAddress {
    return { table, legacyId, version: group.version, column: row.column };
  }

  function onFindingApprove(group: RowDetailRuleGroup, row: RuleDetailRow) {
    const address = addressOf(group, row);

    press(async () => {
      const report = await approveRow(group.ruleId, address);
      return report.approved === 0
        ? `Nothing to approve: ${legacyId}, ${address.column} was already settled.`
        : `Approved ${address.column} on ${legacyId} (${group.ruleName}).`;
    });
  }

  /** The human's own answer to a finding the rule could not answer (1.1.12, 1.2.13). */
  function onFindingApproveWithValue(group: RowDetailRuleGroup, row: RuleDetailRow, value: string) {
    const address = addressOf(group, row);

    press(async () => {
      const report = await approveRow(group.ruleId, address, { value });
      return report.approved === 0
        ? `Nothing to set: ${legacyId}, ${address.column} was already settled.`
        : `Set ${address.column} on ${legacyId} to "${value}".`;
    });
  }

  function onFindingDeclineWithReason(
    group: RowDetailRuleGroup,
    row: RuleDetailRow,
    reason: string,
  ) {
    const address = addressOf(group, row);

    press(async () => {
      const report = await declineRow(group.ruleId, address, reason);
      return report.declined === 0
        ? `Nothing to decline: ${legacyId}, ${address.column} was already settled.`
        : `Declined ${address.column} on ${legacyId} (${group.ruleName}).`;
    });
  }

  function onFindingDecline(group: RowDetailRuleGroup, row: RuleDetailRow) {
    setDeclining({
      ruleId: group.ruleId,
      ruleName: group.ruleName,
      row,
      address: addressOf(group, row),
    });
  }

  function runDecline({ reason, modifyRule }: DeclineDecision) {
    const target = declining;
    if (target === null) return;

    setDeclining(null);

    const { ruleId, ruleName, address } = target;

    if (modifyRule) {
      press(async () => {
        const report = await reviseFromRow(ruleId, address, reason);
        return report.version === null
          ? `${ruleName} has no active version, so nothing was sent for revision.`
          : `Sent ${ruleName} v${report.version} for revision. ${legacyId}, ${address.column} stays pending.`;
      });
      return;
    }

    press(async () => {
      const report = await declineRow(ruleId, address);
      return report.declined === 0
        ? `Nothing to decline: ${legacyId}, ${address.column} was already settled.`
        : `Declined ${address.column} on ${legacyId} (${ruleName}).`;
    });
  }

  /** Approve all (1.6.4): every pending finding that proposes a value; ambiguous ones stay pending. */
  function onApproveAll() {
    press(async () => {
      const report = await approveAllOnRow(table, legacyId);
      const base = `Approved ${count(report.approved, 'finding')} on ${legacyId}.`;
      return report.skipped === 0
        ? base
        : `${base} ${count(report.skipped, 'finding')} still need a value.`;
    });
  }

  /** Decline all (1.6.5): every pending finding, ambiguous ones included, declined forever. */
  function onDeclineAll(reason: string | undefined) {
    setDialog(null);

    press(async () => {
      const report = await declineAllOnRow(table, legacyId, reason);
      return report.declined === 0
        ? `Nothing was pending on ${legacyId}.`
        : `Declined ${count(report.declined, 'finding')} on ${legacyId}.`;
    });
  }

  function onReject(reason: string | undefined) {
    setDialog(null);
    pressRejection(() => rejectRow(table, legacyId, reason), `Rejected ${legacyId}.`);
  }

  function onUnreject() {
    pressRejection(() => unrejectRow(table, legacyId), `Un-rejected ${legacyId}.`);
  }

  /** A field corrected by hand (1.6.7), logged under "Hand edit" with its note. Null clears the field. */
  function saveEdit(value: string | null) {
    if (editing === null || editing.note.trim() === '') return;
    const { column } = editing;
    const note = editing.note.trim();

    press(
      async () => {
        const report = await editRow(table, legacyId, column, value, note);
        return report.nextValue === null
          ? `Cleared ${column} on ${legacyId}.`
          : `Set ${column} on ${legacyId} to "${report.nextValue}".`;
      },
      () => setEditing(null),
    );
  }

  if (state.kind === 'loading') {
    return (
      <Group gap="sm">
        <Loader size="sm" />
        <Text size="sm">Loading {legacyId}</Text>
      </Group>
    );
  }

  if (state.kind === 'failed') {
    return (
      <Alert color="red" title="This row could not be loaded">
        <Stack gap="xs">
          <Text size="sm">{state.error.message}</Text>
          <Group>
            <Button
              size="xs"
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
  const columns = detail.dataRows[0] === undefined ? [] : Object.keys(detail.dataRows[0]);
  const editable = !imported && !rejected;
  const pendingCount = detail.findings.reduce((sum, group) => sum + group.pending.length, 0);
  // Approve all takes only findings that propose a value (1.6.4), so a row whose
  // pending findings are all ambiguous has nothing for it to approve.
  const anyApprovable = detail.findings.some(
    (group) => !group.ambiguous && group.pending.length > 0,
  );

  const status = imported
    ? 'Imported as a new patient. Nothing here can change any more.'
    : rejected
      ? table === 'patient'
        ? 'Rejected. This patient will not be imported.'
        : 'Rejected.'
      : pendingCount > 0
        ? `${count(pendingCount, 'open problem')}.`
        : 'No open problems.';

  const openGroups = detail.findings.filter((group) => group.pending.length > 0);
  const log: LogEntry[] = detail.findings.flatMap((group) =>
    group.settled.map((finding) => ({
      ...finding,
      key: `${group.ruleId}:${group.version}:${finding.column}`,
      ruleName: group.ruleName,
    })),
  );

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="xs">
          {rejected && !imported && (
            <Badge color="red" variant="light">
              Rejected
            </Badge>
          )}
          <Text size="sm" c="dimmed">
            {status}
          </Text>
        </Group>

        {!imported && (
          <Group gap="xs">
            {busy && <Loader size="xs" />}
            {editable && pendingCount > 0 && (
              <>
                <Button
                  size="xs"
                  color="green"
                  disabled={busy || !anyApprovable}
                  onClick={onApproveAll}
                >
                  Approve all
                </Button>
                <Button
                  size="xs"
                  color="red"
                  variant="light"
                  disabled={busy}
                  onClick={() => setDialog('declineAll')}
                >
                  Decline all
                </Button>
              </>
            )}
            {editable && (
              <Button
                size="xs"
                color="red"
                variant="subtle"
                disabled={busy}
                onClick={() => setDialog('reject')}
              >
                Reject row
              </Button>
            )}
            {rejected && (
              <Button size="xs" variant="light" disabled={busy} onClick={onUnreject}>
                Un-reject
              </Button>
            )}
          </Group>
        )}
      </Group>

      {actionError !== null && (
        <Alert
          color="red"
          title="That did not go through"
          withCloseButton
          onClose={() => setActionError(null)}
        >
          <Text size="sm">{actionError} Nothing was changed.</Text>
        </Alert>
      )}

      <Stack gap="xs">
        <Text fw={600} size="sm">
          Values
        </Text>
        {detail.dataRows.length > 1 && (
          <Text size="xs" c="dimmed">
            {detail.dataRows.length} rows share this legacy id (1.0.3); an edit applies to all of
            them.
          </Text>
        )}
        <Table.ScrollContainer minWidth={480}>
          <Table withTableBorder verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={180}>Field</Table.Th>
                {detail.dataRows.length === 1 ? (
                  <Table.Th>Value</Table.Th>
                ) : (
                  detail.dataRows.map((_, index) => (
                    <Table.Th key={index}>Row {index + 1}</Table.Th>
                  ))
                )}
                {editable && <Table.Th w={80} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {columns.map((column) =>
                editing?.column === column ? (
                  <Table.Tr key={column}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {column}
                      </Text>
                    </Table.Td>
                    <Table.Td colSpan={detail.dataRows.length + 1}>
                      <Stack gap={6}>
                        <TextInput
                          size="xs"
                          aria-label={`New value for ${column}`}
                          value={editing.value}
                          disabled={busy}
                          onChange={(event) =>
                            setEditing({ ...editing, value: event.currentTarget.value })
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') saveEdit(editing.value);
                            if (event.key === 'Escape') setEditing(null);
                          }}
                          data-autofocus
                          autoFocus
                        />
                        <TextInput
                          size="xs"
                          aria-label={`Why ${column} is being changed`}
                          placeholder="Why are you changing it? (required)"
                          value={editing.note}
                          disabled={busy}
                          onChange={(event) =>
                            setEditing({ ...editing, note: event.currentTarget.value })
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') saveEdit(editing.value);
                            if (event.key === 'Escape') setEditing(null);
                          }}
                        />
                        <Group gap="xs" wrap="nowrap">
                          <Button
                            size="xs"
                            disabled={busy || editing.note.trim() === ''}
                            onClick={() => saveEdit(editing.value)}
                          >
                            Save
                          </Button>
                          <Button
                            size="xs"
                            variant="light"
                            color="gray"
                            disabled={busy || editing.note.trim() === ''}
                            onClick={() => saveEdit(null)}
                          >
                            Set to none
                          </Button>
                          <Button
                            size="xs"
                            variant="default"
                            disabled={busy}
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </Button>
                        </Group>
                      </Stack>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  <Table.Tr key={column}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {column}
                      </Text>
                    </Table.Td>
                    {detail.dataRows.map((row, index) => (
                      <Table.Td key={index}>
                        <Text
                          size="sm"
                          c={row[column] === null || row[column] === '' ? 'dimmed' : undefined}
                          style={{ wordBreak: 'break-word' }}
                        >
                          {row[column] === null
                            ? '(none)'
                            : row[column] === ''
                              ? '(empty)'
                              : row[column]}
                        </Text>
                      </Table.Td>
                    ))}
                    {editable && (
                      <Table.Td>
                        <Group justify="flex-end">
                          <Button
                            size="xs"
                            variant="subtle"
                            disabled={busy || editing !== null}
                            onClick={() =>
                              setEditing({
                                column,
                                value: detail.dataRows[0]?.[column] ?? '',
                                note: '',
                              })
                            }
                          >
                            Edit
                          </Button>
                        </Group>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ),
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>

      {openGroups.length > 0 && (
        <Stack gap="md">
          <Text fw={600} size="sm">
            Open problems
          </Text>
          {openGroups.map((group) => {
            const pendingRows = group.pending.map((finding) =>
              toRuleDetailRow(table, legacyId, finding),
            );

            return (
              <Stack key={`${group.ruleId}:${group.version}`} gap="xs">
                <Group gap="xs">
                  <Text size="sm" fw={500}>
                    {group.ruleName}
                  </Text>
                  <Text size="xs" c="dimmed">
                    v{group.version}
                  </Text>
                  {group.ambiguous && (
                    <Badge variant="light" color="yellow">
                      Needs a value
                    </Badge>
                  )}
                </Group>

                <RuleRowsTable
                  rows={pendingRows}
                  hideRowIdentity
                  ambiguous={group.ambiguous}
                  description={group.description}
                  actions={
                    editable
                      ? {
                          onApprove: (row) => onFindingApprove(group, row),
                          onDecline: (row) => onFindingDecline(group, row),
                          onApproveWithValue: (row, value) =>
                            onFindingApproveWithValue(group, row, value),
                          onDeclineWithReason: (row, reason) =>
                            onFindingDeclineWithReason(group, row, reason),
                          busy,
                        }
                      : undefined
                  }
                />
              </Stack>
            );
          })}
        </Stack>
      )}

      {log.length > 0 && (
        <Stack gap="xs">
          <Text fw={600} size="sm">
            Log
          </Text>
          <Text size="xs" c="dimmed">
            Every change made to this row, and every problem declined. Accepted changes came from a
            rule; changes made by hand carry the note given with them; declined ones kept the value
            the row had.
          </Text>
          <Table.ScrollContainer minWidth={720}>
            <Table withTableBorder verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={140}>Result</Table.Th>
                  <Table.Th>Problem</Table.Th>
                  <Table.Th w={130}>Column</Table.Th>
                  <Table.Th>Before</Table.Th>
                  <Table.Th>After</Table.Th>
                  <Table.Th>Note</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {log.map((entry) => {
                  const pieces = logPieces(entry);
                  const accepted = entry.status === 'approved';

                  return (
                    <Table.Tr key={entry.key}>
                      <Table.Td>
                        <Badge
                          variant="light"
                          color={entry.byHand ? 'blue' : accepted ? 'green' : 'gray'}
                        >
                          {entry.byHand ? 'Changed by hand' : accepted ? 'Accepted' : 'Declined'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{entry.ruleName}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{entry.column}</Text>
                      </Table.Td>
                      <Table.Td>
                        <DiffValue pieces={pieces.before} tone={accepted ? 'removed' : 'plain'} />
                      </Table.Td>
                      <Table.Td>
                        <DiffValue pieces={pieces.after} tone={accepted ? 'added' : 'plain'} />
                      </Table.Td>
                      <Table.Td>
                        <Text
                          size="sm"
                          c={entry.note === null ? 'dimmed' : undefined}
                          style={{ wordBreak: 'break-word' }}
                        >
                          {entry.note ?? '—'}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      )}

      {declining !== null && (
        <DeclineDialog
          key={`${declining.address.column}:${declining.ruleId}:${declining.address.version}`}
          target={{ kind: 'row', ruleName: declining.ruleName, row: declining.row }}
          onCancel={() => setDeclining(null)}
          onConfirm={runDecline}
        />
      )}

      {dialog === 'declineAll' && (
        <ReasonDialog
          title={`Decline all open problems on ${legacyId}`}
          message={`All ${count(pendingCount, 'open problem')} on this row are declined: the row keeps its values, and no rule raises them again.`}
          confirmLabel="Decline all"
          color="red"
          onCancel={() => setDialog(null)}
          onConfirm={onDeclineAll}
        />
      )}

      {dialog === 'reject' && (
        <ReasonDialog
          title={`Reject ${legacyId}`}
          message={
            table === 'patient'
              ? 'This patient will not be imported. You can un-reject it later.'
              : 'This row is set aside. You can un-reject it later.'
          }
          confirmLabel="Reject row"
          color="red"
          onCancel={() => setDialog(null)}
          onConfirm={onReject}
        />
      )}
    </Stack>
  );
}
