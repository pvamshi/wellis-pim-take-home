import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Code, Group, Loader, Stack, Text } from '@mantine/core';
import {
  ApiError,
  approveRow,
  approveRule,
  declineRow,
  declineRule,
  getRuleDetail,
  reviseFromRow,
  ruleUrl,
} from '../api/client';
import type { RuleDetailResponse, RuleDetailRow, RuleRowAddress } from '../api/types';
import { DeclineDialog, type DeclineDecision } from './DeclineDialog';
import { RuleRowsTable } from './RuleRowsTable';

type RequestState =
  | { kind: 'loading' }
  | { kind: 'loaded'; detail: RuleDetailResponse }
  | { kind: 'failed'; error: ApiError };

/**
 * The cross that is waiting on the dialog, or null while none is.
 *
 * The row cross resolves its address when it is pressed rather than when it is
 * confirmed, so the press decides the row the operator was looking at even if
 * the detail were re-read underneath the open dialog.
 */
type DeclineTarget =
  { kind: 'rule' } | { kind: 'row'; row: RuleDetailRow; address: RuleRowAddress };

export interface RuleDetailPanelProps {
  readonly ruleId: string;
  /**
   * Called after a press has landed, with one line saying what it did.
   *
   * The page above shows that line and re-reads its list. It has to come from
   * here, because a rule-level press takes the rule off the list (1.2.1) and
   * this panel goes with it — without the line, the press would leave no trace.
   */
  readonly onChanged: (outcome: string) => void;
}

/** How many rows, in words that read the same for one as for many. */
function rowCount(n: number): string {
  return n === 1 ? '1 row' : `${n} rows`;
}

/**
 * One expanded rule (1.2.2): its two sections, before and after per row
 * (1.2.3), a tick and a cross on every pending row and Approve and Decline on
 * the rule (1.2.4, 1.2.7).
 *
 * Five things the code does not say on its own:
 *
 * - **It reads on mount, and it is mounted by being expanded.** The accordion
 *   above unmounts collapsed panels, so the detail of a rule nobody opened is
 *   never fetched, and re-opening one re-reads it.
 * - **The screen's truth always comes from re-reading.** After any press this
 *   panel re-reads its own detail and tells the page to re-read the list. A
 *   press's report body is used for the outcome line and for nothing else — it
 *   says what the press did, not what the rule now is.
 * - **A press names the detail's version, not the list's.** Both sections were
 *   read from the active version, so that is the version whose rows are on the
 *   screen and the only one a press on them can mean.
 * - **A rule with no active version can still be looked at.** It is a rule
 *   parked by a decline (1.2.6): both sections come back empty and there is
 *   nothing to press, which the note below says rather than leaving an empty
 *   panel to be read as a failure.
 * - **A failed press changes nothing on the screen.** The error is shown and
 *   the row stays exactly where it was, because the panel never moves a row on
 *   its own — only a re-read does.
 * - **Neither cross posts on its own.** Both open `DeclineDialog`, and its two
 *   answers — the optional reason, and the "modify the rule" tick — decide
 *   which of three presses this panel then makes (1.2.6, 1.2.7, 1.2.8).
 */
export function RuleDetailPanel({ ruleId, onChanged }: RuleDetailPanelProps) {
  const [state, setState] = useState<RequestState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [declining, setDeclining] = useState<DeclineTarget | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    // Every rejection is handled here, so nothing escapes as an unhandled
    // promise rejection: a backend that is not running renders the Alert below.
    getRuleDetail(ruleId, controller.signal)
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
            cause instanceof ApiError ? cause : new ApiError(String(cause), null, ruleUrl(ruleId)),
        });
      });

    return () => controller.abort();
  }, [ruleId, attempt]);

  /**
   * Runs one press, then re-reads.
   *
   * The re-read is the point: it is what moves a row between the sections, so
   * a press that fails leaves the screen exactly as it was, showing the row it
   * could not decide. Nothing is written into state from the report.
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
          cause instanceof ApiError ? cause : new ApiError(String(cause), null, ruleUrl(ruleId)),
        );
      })
      .finally(() => setBusy(false));
  }

  if (state.kind === 'loading') {
    return (
      <Group gap="sm">
        <Loader size="sm" />
        <Text size="sm">
          Reading <Code>{ruleUrl(ruleId)}</Code>
        </Text>
      </Group>
    );
  }

  if (state.kind === 'failed') {
    return (
      <Alert color="red" title="This rule could not be read">
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
  const { version } = detail;

  // The address of one row: what the screen holds, plus the version both
  // sections were read from. Null when there is no active version, in which
  // case there are no rows to press on either.
  function addressOf(row: RuleDetailRow): RuleRowAddress | null {
    return version === null
      ? null
      : { table: row.table, legacyId: row.legacyId, version, column: row.column };
  }

  function onRowApprove(row: RuleDetailRow) {
    const address = addressOf(row);
    if (address === null) return;

    press(async () => {
      const report = await approveRow(ruleId, address);
      return report.approved === 0
        ? `Nothing to approve on ${detail.ruleName}: ${address.table} ${address.legacyId}, ${address.column} was already settled.`
        : `Approved ${address.table} ${address.legacyId}, ${address.column} of ${detail.ruleName}, updating ${rowCount(report.updated)} of legacy data.`;
    });
  }

  /**
   * The human's own answer to a finding the rule could not answer (1.1.12).
   *
   * The same endpoint as the tick, carrying the value they typed: an ambiguous
   * rule proposes nothing, so there is nothing for a bare approve to write, and
   * this is what gives such a row a way to be settled other than declining it.
   * Blank is a real answer — it says the column should hold nothing — so it is
   * sent like any other.
   */
  function onRowApproveWithValue(row: RuleDetailRow, value: string) {
    const address = addressOf(row);
    if (address === null) return;

    press(async () => {
      const report = await approveRow(ruleId, address, value);
      return report.approved === 0
        ? `Nothing to set on ${detail.ruleName}: ${address.table} ${address.legacyId}, ${address.column} was already settled.`
        : `Set ${address.table} ${address.legacyId}, ${address.column} to "${value}", updating ${rowCount(report.updated)} of legacy data.`;
    });
  }

  /**
   * The cross on an ambiguous row, pressed inline rather than through the
   * dialog (1.2.7).
   *
   * The dialog exists to choose between declining a row and parking the whole
   * version (1.2.8), and to collect the reason for either. On an ambiguous row
   * that choice is already made by which button was pressed — "the rule itself
   * is wrong" still opens the dialog — so all that is left is the reason, and a
   * box on the row is a shorter way to type one than a dialog.
   */
  function onRowDeclineWithReason(row: RuleDetailRow, reason: string) {
    const address = addressOf(row);
    if (address === null) return;

    press(async () => {
      const report = await declineRow(ruleId, address, reason);
      return report.declined === 0
        ? `Nothing to decline on ${detail.ruleName}: ${address.table} ${address.legacyId}, ${address.column} was already settled.`
        : `Declined ${address.table} ${address.legacyId}, ${address.column} of ${detail.ruleName}. It will never be proposed again.`;
    });
  }

  // Neither cross posts anything. Both open the dialog, which is where the
  // reason is typed and — for a row — where the two opposite outcomes of the
  // "modify the rule" tick are chosen between (1.2.6, 1.2.7, 1.2.8).
  function onRowDecline(row: RuleDetailRow) {
    const address = addressOf(row);
    if (address === null) return;

    setDeclining({ kind: 'row', row, address });
  }

  function onRuleApprove() {
    press(async () => {
      const report = await approveRule(ruleId);
      return report.version === null
        ? `${detail.ruleName} has no active version, so nothing was approved.`
        : `Approved ${rowCount(report.approved)} of ${detail.ruleName} v${report.version}, updating ${rowCount(report.updated)} of legacy data.`;
    });
  }

  function onRuleDecline() {
    setDeclining({ kind: 'rule' });
  }

  /**
   * The press the dialog was opened for, with what the operator answered.
   *
   * The tick is what chooses between the two row routes and is never sent as a
   * field: unticked declines the row (1.2.7), ticked parks the rule and leaves
   * the row pending (1.2.8). The backend serves them separately for exactly
   * that reason, and a screen that decided it in a body would undo it.
   *
   * The reason goes with the two presses that park a version and store it
   * there (1.2.6, 1.2.8). The unticked cross sends none: the dialog asks for no
   * reason on that branch, so there is none to pass on.
   *
   * The dialog closes first. A failed press shows the alert above and changes
   * nothing else, and a modal left open over it would hide the only thing the
   * operator needs to read; the cost is a typed reason lost on a failure, which
   * is one re-open (1.2.12).
   */
  function runDecline({ reason, modifyRule }: DeclineDecision) {
    const target = declining;
    if (target === null) return;

    setDeclining(null);

    if (target.kind === 'rule') {
      press(async () => {
        const report = await declineRule(ruleId, reason);
        return report.version === null
          ? `${detail.ruleName} has no active version, so nothing was declined.`
          : `Declined ${detail.ruleName} v${report.version}. It leaves the list until a new version is written.`;
      });
      return;
    }

    const { address } = target;

    if (modifyRule) {
      press(async () => {
        const report = await reviseFromRow(ruleId, address, reason);
        return report.version === null
          ? `${detail.ruleName} has no active version, so nothing was sent for revision.`
          : `Sent ${detail.ruleName} v${report.version} for revision, from ${address.table} ${address.legacyId}, ${address.column}. That row stays pending, so the next version proposes on it.`;
      });
      return;
    }

    press(async () => {
      const report = await declineRow(ruleId, address);
      return report.declined === 0
        ? `Nothing to decline on ${detail.ruleName}: ${address.table} ${address.legacyId}, ${address.column} was already settled.`
        : `Declined ${address.table} ${address.legacyId}, ${address.column} of ${detail.ruleName}. It will never be proposed again.`;
    });
  }

  return (
    <Stack gap="lg">
      <Text size="sm">{detail.description}</Text>

      {detail.ambiguous && (
        <Alert color="yellow" title="This rule cannot propose a value">
          <Text size="sm">
            It can tell that these rows are wrong but not what they should be — the description
            above is the whole of what it found. So there is nothing to tick: type what the column
            should hold and press Apply, or decline the row to leave it as it is and never be asked
            again. If the rule is asking the wrong question altogether, send it for revision
            instead.
          </Text>
        </Alert>
      )}

      {version === null && (
        <Alert color="yellow" title="No active version">
          <Text size="sm">
            This rule has no active version, so it has no rows awaiting a decision and nothing to
            approve or decline. It is waiting for a new version to be written.
          </Text>
        </Alert>
      )}

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
            <Text size="sm">Nothing was decided. The rows below are unchanged.</Text>
          </Stack>
        </Alert>
      )}

      <Stack gap="xs">
        <Group gap="xs">
          <Text fw={600}>Pending</Text>
          <Badge variant="light">{detail.pending.length}</Badge>
        </Group>
        {detail.pending.length === 0 ? (
          <Text size="sm" c="dimmed">
            No rows are awaiting a decision.
          </Text>
        ) : (
          <RuleRowsTable
            rows={detail.pending}
            ambiguous={detail.ambiguous}
            description={detail.description}
            actions={{
              onApprove: onRowApprove,
              onDecline: onRowDecline,
              onApproveWithValue: onRowApproveWithValue,
              onDeclineWithReason: onRowDeclineWithReason,
              busy,
            }}
          />
        )}
      </Stack>

      <Stack gap="xs">
        <Group gap="xs">
          <Text fw={600}>Approved</Text>
          <Badge variant="light" color="green">
            {detail.approved.length}
          </Badge>
        </Group>
        {detail.approved.length === 0 ? (
          <Text size="sm" c="dimmed">
            Nothing has been approved yet.
          </Text>
        ) : (
          /*
            No tick and no cross here. An approved row is settled: there is no
            undo (1.2.11, deferred.md D2), and the presses move only rows that
            are still pending.
          */
          <RuleRowsTable
            rows={detail.approved}
            ambiguous={detail.ambiguous}
            description={detail.description}
          />
        )}
      </Stack>

      <Group>
        {/*
          Not drawn at all for an ambiguous rule. Ambiguity is rule-wide
          (1.1.12), so every one of its pending rows proposes nothing and a
          rule-level approve has nothing whatever to apply — it is the row tick's
          bigger sibling, and the same button that could only fail. Disabling it
          would be the wrong shape: there is no state of an ambiguous rule in
          which it becomes pressable, so it does not belong on the screen.
        */}
        {!detail.ambiguous && (
          <Button
            color="green"
            onClick={onRuleApprove}
            disabled={busy || version === null || detail.pending.length === 0}
          >
            Approve rule
          </Button>
        )}
        <Button
          color="red"
          variant="light"
          onClick={onRuleDecline}
          disabled={busy || version === null}
        >
          Decline rule
        </Button>
        {busy && <Loader size="sm" />}
      </Group>

      {/*
        Mounted only while a cross is waiting on an answer, and keyed by which
        cross it was. Both together are what make every open start from an
        empty reason and an unticked box: a dialog that stayed mounted would
        carry the last press's typed reason to the next row.
      */}
      {declining !== null && (
        <DeclineDialog
          key={
            declining.kind === 'rule'
              ? 'rule'
              : `${declining.address.table}:${declining.address.legacyId}:${declining.address.column}`
          }
          target={
            declining.kind === 'rule'
              ? { kind: 'rule', ruleName: detail.ruleName }
              : { kind: 'row', ruleName: detail.ruleName, row: declining.row }
          }
          onCancel={() => setDeclining(null)}
          onConfirm={runDecline}
        />
      )}
    </Stack>
  );
}
