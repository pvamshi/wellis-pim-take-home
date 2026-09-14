import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
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
  RowRejectionReport,
  RuleDetailRow,
  RuleRowAddress,
} from '../api/types';
import { DeclineDialog, type DeclineDecision } from './DeclineDialog';
import { RuleRowsTable } from './RuleRowsTable';

type RequestState =
  | { kind: 'loading' }
  | { kind: 'loaded'; detail: RowDetailResponse }
  | { kind: 'failed'; error: ApiError };

/**
 * The cross that is waiting on the dialog, or null while none is.
 *
 * Unlike `RuleDetailPanel`'s own `DeclineTarget`, there is no `'rule'` kind
 * here (1.6's own opening paragraph: "decline this whole rule" is the rules
 * screen's unit, not this one's) and the rule id travels with the target,
 * because a row's findings can span several rules and versions at once —
 * `RuleDetailPanel` never needs to carry one because its whole panel is
 * already one rule.
 */
interface DeclineTarget {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly row: RuleDetailRow;
  readonly address: RuleRowAddress;
}

export interface RowDetailPanelProps {
  readonly table: LegacySourceTable;
  readonly legacyId: string;
  /**
   * Whether the list showed this row as rejected at the moment it was
   * expanded. `GET /rows/:table/:legacyId` itself carries no rejection field
   * (1.6.2 keeps rejection stored and read separately from what that endpoint
   * joins), so Reject/Un-reject visibility starts here and is then kept in
   * this panel's own state, updated from each press's own `rejected` answer.
   */
  readonly initialRejected: boolean;
  /**
   * Called after a press has landed, with one line saying what it did.
   *
   * The page above shows that line and re-reads its list — the same reason
   * `RuleDetailPanel.onChanged` exists: a press here can change this row's
   * state (1.6.2), which only the list computes.
   */
  readonly onChanged: (outcome: string) => void;
}

/** How many rows, in words that read the same for one as for many. */
function rowCount(n: number): string {
  return n === 1 ? '1 row' : `${n} rows`;
}

/**
 * One finding, reshaped into the rules screen's own row shape so it can be
 * handed straight into the unmodified `RuleRowsTable` — the same before/after
 * (`ValueDiff`) and the same box-not-tick ambiguous handling, with no second
 * copy of either written for this screen.
 */
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

/**
 * One expanded row (1.6.3): its own column values, its findings grouped by
 * rule, Approve all / Decline all (1.6.4, 1.6.5), Reject / Un-reject (1.6.6)
 * and a hand-edit form (1.6.7).
 *
 * `RuleDetailPanel`'s counterpart for this screen, and it follows the same
 * five rules that one's own comment states: it reads on mount (and is mounted
 * by being expanded), the screen's truth always comes from re-reading, a
 * finding-level press names the group's own `(ruleId, version)` rather than
 * anything list-wide, a failed press changes nothing on the screen, and
 * neither finding's cross posts on its own — both open `DeclineDialog`.
 */
export function RowDetailPanel({
  table,
  legacyId,
  initialRejected,
  onChanged,
}: RowDetailPanelProps) {
  const [state, setState] = useState<RequestState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [declining, setDeclining] = useState<DeclineTarget | null>(null);
  const [rejected, setRejected] = useState(initialRejected);
  const [rejectReason, setRejectReason] = useState('');
  const [declineAllReason, setDeclineAllReason] = useState('');
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [clearColumn, setClearColumn] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    // Every rejection is handled here, so nothing escapes as an unhandled
    // promise rejection: a backend that is not running renders the Alert
    // below.
    getRowDetail(table, legacyId, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'loaded', detail });
      })
      .catch((cause: unknown) => {
        // An abort means this panel was collapsed; there is no one to tell.
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

  // Defaults the edit form to the row's first column, once, when the detail
  // first loads. A later reload (after any press) leaves it alone: the set of
  // columns never changes for a fixed table, so there is nothing to
  // re-default, and doing so would overwrite whatever the operator was typing
  // mid-edit.
  useEffect(() => {
    if (state.kind !== 'loaded' || selectedColumn !== null) return;

    const first = state.detail.dataRows[0];
    if (first === undefined) return;

    const firstColumn = Object.keys(first)[0];
    if (firstColumn === undefined) return;

    setSelectedColumn(firstColumn);
    setEditValue(first[firstColumn] ?? '');
  }, [state, selectedColumn]);

  /**
   * Runs one press that changes the row's findings or values, then re-reads
   * the detail.
   *
   * The re-read is the point: it is what moves a finding between pending and
   * settled and what refreshes `dataRows`, so a press that fails leaves the
   * screen exactly as it was.
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
          cause instanceof ApiError
            ? cause
            : new ApiError(String(cause), null, rowUrl(table, legacyId)),
        );
      })
      .finally(() => setBusy(false));
  }

  /**
   * Reject and un-reject touch no finding and no legacy value — `RowDetail`
   * carries no rejection field for either to change — so this updates local
   * state from the press's own report instead of re-reading the detail.
   */
  function pressRejection(
    run: () => Promise<RowRejectionReport>,
    outcome: (report: RowRejectionReport) => string,
  ) {
    setBusy(true);
    setActionError(null);

    run()
      .then((report) => {
        setRejected(report.rejected);
        onChanged(outcome(report));
      })
      .catch((cause: unknown) => {
        setActionError(
          cause instanceof ApiError
            ? cause
            : new ApiError(String(cause), null, rowUrl(table, legacyId)),
        );
      })
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
        ? `Nothing to approve on ${group.ruleName}: ${table} ${legacyId}, ${address.column} was already settled.`
        : `Approved ${table} ${legacyId}, ${address.column} of ${group.ruleName}, updating ${rowCount(report.updated)} of legacy data.`;
    });
  }

  /** The human's own answer to a finding the rule could not answer (1.1.12, 1.2.13). */
  function onFindingApproveWithValue(group: RowDetailRuleGroup, row: RuleDetailRow, value: string) {
    const address = addressOf(group, row);

    press(async () => {
      const report = await approveRow(group.ruleId, address, value);
      return report.approved === 0
        ? `Nothing to set on ${group.ruleName}: ${table} ${legacyId}, ${address.column} was already settled.`
        : `Set ${table} ${legacyId}, ${address.column} to "${value}", updating ${rowCount(report.updated)} of legacy data.`;
    });
  }

  /** The cross on an ambiguous finding, pressed inline rather than through the dialog (1.2.13). */
  function onFindingDeclineWithReason(
    group: RowDetailRuleGroup,
    row: RuleDetailRow,
    reason: string,
  ) {
    const address = addressOf(group, row);

    press(async () => {
      const report = await declineRow(group.ruleId, address, reason);
      return report.declined === 0
        ? `Nothing to decline on ${group.ruleName}: ${table} ${legacyId}, ${address.column} was already settled.`
        : `Declined ${table} ${legacyId}, ${address.column} of ${group.ruleName}. It will never be proposed again.`;
    });
  }

  // Neither cross posts anything. Both open the dialog, which is where the
  // reason is typed and where the two opposite outcomes of the "modify the
  // rule" tick are chosen between (1.2.7, 1.2.8) — this row's own group
  // carries the ruleId/version that choice acts on.
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
          : `Sent ${ruleName} v${report.version} for revision, from ${table} ${legacyId}, ${address.column}. That row stays pending, so the next version proposes on it.`;
      });
      return;
    }

    press(async () => {
      const report = await declineRow(ruleId, address);
      return report.declined === 0
        ? `Nothing to decline on ${ruleName}: ${table} ${legacyId}, ${address.column} was already settled.`
        : `Declined ${table} ${legacyId}, ${address.column} of ${ruleName}. It will never be proposed again.`;
    });
  }

  /**
   * Approve all (1.6.4): every pending finding that proposes a value,
   * approved and written in one transaction; ambiguous ones are left pending
   * and reported so the press never looks like it finished a row it did not.
   */
  function onApproveAll() {
    press(async () => {
      const report = await approveAllOnRow(table, legacyId);
      const base = `Approved ${rowCount(report.approved)} on ${table} ${legacyId}, updating ${rowCount(report.updated)} of legacy data.`;
      return report.skipped === 0
        ? base
        : `${base} ${rowCount(report.skipped)} left pending — ambiguous, with nothing to tick.`;
    });
  }

  /** Decline all (1.6.5): every pending finding, ambiguous ones included, declined forever. */
  function onDeclineAll() {
    const reason = declineAllReason.trim();

    press(async () => {
      const report = await declineAllOnRow(table, legacyId, reason === '' ? undefined : reason);
      return report.declined === 0
        ? `Nothing to decline on ${table} ${legacyId}: nothing was pending.`
        : `Declined ${rowCount(report.declined)} on ${table} ${legacyId}. Every one of them is declined forever.`;
    });
  }

  function onReject() {
    const reason = rejectReason.trim();

    pressRejection(
      () => rejectRow(table, legacyId, reason === '' ? undefined : reason),
      () => `Rejected ${table} ${legacyId}. It is not offered for promotion.`,
    );
  }

  function onUnreject() {
    pressRejection(
      () => unrejectRow(table, legacyId),
      () => `Un-rejected ${table} ${legacyId}.`,
    );
  }

  function onColumnChange(column: string, dataRows: RowDetailResponse['dataRows']) {
    setSelectedColumn(column);
    setClearColumn(false);
    setEditValue(dataRows[0]?.[column] ?? '');
  }

  /** A field corrected by hand (1.6.7): written and logged as an approved finding. */
  function onSubmitEdit() {
    if (selectedColumn === null) return;
    const column = selectedColumn;

    press(async () => {
      const report = await editRow(table, legacyId, column, clearColumn ? null : editValue);
      return report.nextValue === null
        ? `Cleared ${table} ${legacyId}, ${report.column}.`
        : `Set ${table} ${legacyId}, ${report.column} to "${report.nextValue}".`;
    });
  }

  if (state.kind === 'loading') {
    return (
      <Group gap="sm">
        <Loader size="sm" />
        <Text size="sm">
          Reading <Code>{rowUrl(table, legacyId)}</Code>
        </Text>
      </Group>
    );
  }

  if (state.kind === 'failed') {
    return (
      <Alert color="red" title="This row could not be read">
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
  const columns = detail.dataRows[0] === undefined ? [] : Object.keys(detail.dataRows[0]);
  const anyPending = detail.findings.some((group) => group.pending.length > 0);

  /**
   * Whether Approve all has anything to approve.
   *
   * Not the same question as `anyPending`. Approve all takes only findings that
   * propose a value (1.6.4), so on a row whose pending findings are all from
   * ambiguous rules it would approve nothing and report the whole row skipped —
   * a press that can only tell you it did nothing. Decline all has no such
   * problem: the cross needs no proposal.
   */
  const anyApprovable = detail.findings.some(
    (group) => !group.ambiguous && group.pending.length > 0,
  );

  return (
    <Stack gap="lg">
      {actionError !== null && (
        <Alert color="red" title="That press did not land">
          <Stack gap="xs">
            <Text size="sm">{actionError.message}</Text>
            {actionError.status !== null && (
              <Text size="sm">HTTP status: {actionError.status}</Text>
            )}
            <Text size="sm">
              URL tried: <Code>{actionError.url}</Code>
            </Text>
            <Text size="sm">Nothing was decided. What is below is unchanged.</Text>
          </Stack>
        </Alert>
      )}

      <Stack gap="xs">
        <Text fw={600}>Row values</Text>
        {/*
          A legacy id names a row without identifying one (1.0.3) — a small
          read-only table, one line per physical row, is the simplest form
          that shows "there is more than one" without inventing a merge UI
          nothing in 1.6 asks for.
        */}
        <Text size="sm" c="dimmed">
          {detail.dataRows.length === 1
            ? 'One physical row carries this legacy id.'
            : `${detail.dataRows.length} physical rows share this legacy id (1.0.3).`}
        </Text>
        <Table.ScrollContainer minWidth={480}>
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                {columns.map((column) => (
                  <Table.Th key={column}>{column}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {detail.dataRows.map((row, index) => (
                <Table.Tr key={index}>
                  {columns.map((column) => (
                    <Table.Td key={column}>
                      <Text size="sm">{row[column] ?? '(none)'}</Text>
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>

      <Stack gap="md">
        <Text fw={600}>Findings</Text>
        {detail.findings.length === 0 && (
          <Text size="sm" c="dimmed">
            No rule has found anything on this row.
          </Text>
        )}
        {detail.findings.map((group) => {
          const pendingRows = group.pending.map((finding) =>
            toRuleDetailRow(table, legacyId, finding),
          );
          const settledRows = group.settled.map((finding) =>
            toRuleDetailRow(table, legacyId, finding),
          );

          return (
            <Stack key={`${group.ruleId}:${group.version}`} gap="xs">
              <Group gap="xs">
                <Text fw={500}>{group.ruleName}</Text>
                <Text size="sm" c="dimmed">
                  v{group.version}
                </Text>
                {group.ambiguous && (
                  <Badge variant="light" color="yellow">
                    Needs a value
                  </Badge>
                )}
              </Group>

              {pendingRows.length > 0 && (
                <RuleRowsTable
                  rows={pendingRows}
                  ambiguous={group.ambiguous}
                  description={group.description}
                  actions={{
                    onApprove: (row) => onFindingApprove(group, row),
                    onDecline: (row) => onFindingDecline(group, row),
                    onApproveWithValue: (row, value) =>
                      onFindingApproveWithValue(group, row, value),
                    onDeclineWithReason: (row, reason) =>
                      onFindingDeclineWithReason(group, row, reason),
                    busy,
                  }}
                />
              )}

              {settledRows.length > 0 && (
                <Stack gap={4}>
                  {/*
                    "Settled", not "Approved": the backend deliberately merges
                    approved and declined into this one bucket, dropping which
                    is which, so a label claiming one would claim a
                    distinction this data no longer carries.
                  */}
                  <Text size="xs" c="dimmed" fw={600}>
                    Settled
                  </Text>
                  <RuleRowsTable
                    rows={settledRows}
                    ambiguous={group.ambiguous}
                    description={group.description}
                  />
                </Stack>
              )}
            </Stack>
          );
        })}
      </Stack>

      <Group align="flex-end">
        <Button color="green" onClick={onApproveAll} disabled={busy || !anyApprovable}>
          Approve all
        </Button>
        <TextInput
          size="sm"
          label="Decline all"
          placeholder="Why (optional)"
          value={declineAllReason}
          disabled={busy || !anyPending}
          aria-label={`Reason for declining all of ${table} ${legacyId}`}
          onChange={(event) => setDeclineAllReason(event.currentTarget.value)}
        />
        <Button color="red" variant="light" onClick={onDeclineAll} disabled={busy || !anyPending}>
          Decline all
        </Button>
        {busy && <Loader size="sm" />}
      </Group>

      <Group align="flex-end">
        {!rejected && (
          <>
            <TextInput
              size="sm"
              label="Reject"
              placeholder="Why (optional)"
              value={rejectReason}
              disabled={busy}
              aria-label={`Reason for rejecting ${table} ${legacyId}`}
              onChange={(event) => setRejectReason(event.currentTarget.value)}
            />
            <Button color="red" onClick={onReject} disabled={busy}>
              Reject
            </Button>
          </>
        )}
        {rejected && (
          <Button variant="light" onClick={onUnreject} disabled={busy}>
            Un-reject
          </Button>
        )}
      </Group>

      <Stack gap="xs">
        <Text fw={600}>Edit a field by hand</Text>
        <Text size="sm" c="dimmed">
          {/*
            1.6.7: a hand edit is written as a finding under a reserved rule
            id, approved in the same transaction that writes it, so it shows
            up above under "Hand edit" the next time this row is read.
          */}
          Written under the reserved &ldquo;Hand edit&rdquo; rule id, so the modification log
          records it like any other change.
        </Text>
        <Group align="flex-end">
          <Select
            label="Column"
            data={columns}
            value={selectedColumn}
            disabled={busy}
            onChange={(value) => value !== null && onColumnChange(value, detail.dataRows)}
          />
          <TextInput
            label="Value"
            value={editValue}
            disabled={busy || clearColumn}
            onChange={(event) => setEditValue(event.currentTarget.value)}
          />
          <Checkbox
            label="Clear this column"
            checked={clearColumn}
            disabled={busy}
            onChange={(event) => setClearColumn(event.currentTarget.checked)}
          />
          <Button onClick={onSubmitEdit} disabled={busy || selectedColumn === null}>
            Save
          </Button>
        </Group>
      </Stack>

      {/*
        Mounted only while a cross is waiting on an answer, and keyed by which
        one it was — the same reason `RuleDetailPanel` keys its own dialog:
        every open should start from an empty reason and an unticked box.
      */}
      {declining !== null && (
        <DeclineDialog
          key={`${declining.address.table}:${declining.address.legacyId}:${declining.address.column}:${declining.ruleId}`}
          target={{ kind: 'row', ruleName: declining.ruleName, row: declining.row }}
          onCancel={() => setDeclining(null)}
          onConfirm={runDecline}
        />
      )}
    </Stack>
  );
}
