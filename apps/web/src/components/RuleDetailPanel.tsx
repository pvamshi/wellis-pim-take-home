import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Code, Group, Loader, Stack, Text, TextInput } from '@mantine/core';
import {
  ApiError,
  approveRow,
  approveRule,
  declineRow,
  declineRule,
  getRuleDetail,
  reviseFromRow,
  reviseRule,
  ruleUrl,
} from '../api/client';
import type {
  RuleDetailResponse,
  RuleDetailRow,
  RuleDetailVersionGroup,
  RuleRowAddress,
  RuleVersionState,
} from '../api/types';
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
interface DeclineTarget {
  readonly row: RuleDetailRow;
  readonly address: RuleRowAddress;
}

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
 * What each version state is called on the screen, and why its rows are here.
 *
 * Every block is labelled, the active one included: a rule whose rows are all
 * on one version should read the same as one whose rows are spread over three,
 * and a heading that appeared only in the awkward case would make the awkward
 * case look like a fault.
 */
const versionStates: Record<RuleVersionState, { label: string; color: string; note: string }> = {
  active: {
    label: 'Active',
    color: 'blue',
    note: 'The version this rule runs as now.',
  },
  needsReview: {
    label: 'Sent for revision',
    color: 'yellow',
    note: 'Parked until a new version is written. It runs nothing, but the rows it already found are still here to decide.',
  },
  superseded: {
    label: 'Superseded',
    color: 'gray',
    note: 'A version the rule has moved on from. Its rows were never decided, and each can still be ticked or crossed.',
  },
};

/**
 * The two presses on an ambiguous rule's own line (1.5.1): guidance for what it
 * should do instead, and a reason to park it as simply wrong.
 *
 * The guidance box opens holding what this rule was last told, so refining it
 * is editing a sentence rather than remembering one. Local state, and keyed by
 * the caller on the stored guidance, so a landed press re-seeds the box from
 * the re-read instead of leaving the old text sitting in it.
 */
function RuleGuidance({
  guidance,
  queued,
  canDecline,
  busy,
  onRevise,
  onDecline,
}: {
  readonly guidance: string | null;
  readonly queued: boolean;
  /** False once the rule has no active version left to park. */
  readonly canDecline: boolean;
  readonly busy: boolean;
  readonly onRevise: (guidance: string) => void;
  readonly onDecline: (reason: string) => void;
}) {
  const [text, setText] = useState(guidance ?? '');
  const [reason, setReason] = useState('');

  return (
    <Stack gap={6}>
      <Group gap={6} wrap="nowrap" align="flex-start">
        <TextInput
          size="xs"
          style={{ flex: 1 }}
          value={text}
          placeholder="What should this rule do instead?"
          aria-label="Guidance for this rule"
          disabled={busy}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <Button
          size="xs"
          color="green"
          disabled={busy || text.trim() === ''}
          onClick={() => onRevise(text.trim())}
        >
          Update
        </Button>
      </Group>
      <Group gap={6} wrap="nowrap" align="flex-start">
        <TextInput
          size="xs"
          style={{ flex: 1 }}
          value={reason}
          placeholder="Why this rule is wrong (optional)"
          aria-label="Reason for declining this rule"
          disabled={busy}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
        <Button
          size="xs"
          color="red"
          variant="light"
          disabled={busy || !canDecline}
          onClick={() => onDecline(reason)}
        >
          Decline
        </Button>
      </Group>
      {queued && (
        <Text size="xs" c="dimmed">
          Already waiting for a new version, so nothing of it is running. Update replaces the
          guidance above.
        </Text>
      )}
    </Stack>
  );
}

/**
 * One expanded rule (1.2.2): its rows under the version that made each, two
 * sections in every block, before and after per row (1.2.3), a tick and a cross
 * on every pending row and Approve and Decline on the rule (1.2.4, 1.2.7).
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
 * - **A press names the version that made the row.** The rows arrive grouped by
 *   version (1.2.2), and a tick or a cross is addressed with the version of the
 *   block it was pressed in — which is what lets a row left behind by a parked
 *   or superseded version still be decided here, exactly as the rows screen
 *   already lets it be decided there.
 * - **A rule with no active version can still be looked at, and still has
 *   rows.** It is a rule parked by a decline (1.2.6): its findings sit on the
 *   version that made them and are listed under it, but there is no rule-level
 *   press to make, which the note below says rather than leaving a disabled
 *   button to be read as a failure.
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
  // The active version: what the rule-level press acts on, and the only thing
  // on this screen that needs one. A row's own version is its group's.
  const { version } = detail;
  // What that press would actually clear. On a rule whose rows are spread over
  // versions this is fewer than the count on the closed line, which counts every
  // version (1.2.1) — so the button says the number rather than implying it.
  const activePending =
    detail.versions.find((group) => group.version === version)?.pending.length ?? 0;

  // The address of one row: what the screen holds, plus the version of the
  // block it was drawn in. Never null — every row here was made by some
  // version, and a press names that one whether or not it is still active.
  function addressOf(group: RuleDetailVersionGroup, row: RuleDetailRow): RuleRowAddress {
    return { table: row.table, legacyId: row.legacyId, version: group.version, column: row.column };
  }

  function onRowApprove(group: RuleDetailVersionGroup, row: RuleDetailRow) {
    const address = addressOf(group, row);

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
  function onRowApproveWithValue(group: RuleDetailVersionGroup, row: RuleDetailRow, value: string) {
    const address = addressOf(group, row);

    press(async () => {
      const report = await approveRow(ruleId, address, { value });
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
  function onRowDeclineWithReason(
    group: RuleDetailVersionGroup,
    row: RuleDetailRow,
    reason: string,
  ) {
    const address = addressOf(group, row);

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
  function onRowDecline(group: RuleDetailVersionGroup, row: RuleDetailRow) {
    setDeclining({ row, address: addressOf(group, row) });
  }

  function onRuleApprove() {
    press(async () => {
      const report = await approveRule(ruleId);
      return report.version === null
        ? `${detail.ruleName} has no active version, so nothing was approved.`
        : `Approved ${rowCount(report.approved)} of ${detail.ruleName} v${report.version}, updating ${rowCount(report.updated)} of legacy data.`;
    });
  }

  /**
   * Guidance for the rule itself (1.5.1): what it should do instead.
   *
   * It parks the rule's active version with that sentence stored on it, which
   * is the queue the revision workflow reads, and decides no row. A rule
   * already waiting takes the new wording onto the version already queued.
   */
  function onRuleRevise(guidance: string) {
    press(async () => {
      const report = await reviseRule(ruleId, guidance);
      return report.version === null
        ? `${detail.ruleName} has no version to send, so the guidance was not stored.`
        : `Sent ${detail.ruleName} v${report.version} to be rewritten, with your guidance. Its rows are untouched.`;
    });
  }

  /** The rule-level cross, inline beside the guidance rather than in a dialog: the reason is all it asks for. */
  function onRuleDeclineWithReason(reason: string) {
    press(async () => {
      const report = await declineRule(ruleId, reason.trim() === '' ? undefined : reason);
      return report.version === null
        ? `${detail.ruleName} has no active version, so nothing was declined.`
        : `Declined ${detail.ruleName} v${report.version}. It leaves the list until a new version is written.`;
    });
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
            above is the whole of what it found. Each row below takes the value it should hold, or a
            reason to leave it as it is. If the rule itself is asking the wrong question, tell it
            below what it should do instead.
          </Text>
        </Alert>
      )}

      {version === null && (
        <Alert color="yellow" title="No active version">
          <Text size="sm">
            This rule is waiting for a new version to be written, so nothing of it is running and
            there is no whole-rule Approve to press. Whatever it already found is listed below under
            the version that found it, and every one of those rows can still be decided on its own.
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

      {/*
        One block per version that found anything, newest first (1.2.2). A rule's
        rows outlive the version that made them — parking one leaves its rows
        where they are (1.2.6) — so a rule can have rows under two or three
        headings, and every row is reachable wherever it sits.
      */}
      {detail.versions.length === 0 ? (
        <Text size="sm" c="dimmed">
          This rule has found nothing. No rows are awaiting a decision, and none has been applied.
        </Text>
      ) : (
        detail.versions.map((group) => (
          <Stack key={group.version} gap="md">
            <Group gap="xs" wrap="nowrap" align="baseline">
              <Text fw={600}>v{group.version}</Text>
              <Badge variant="light" color={versionStates[group.state].color}>
                {versionStates[group.state].label}
              </Badge>
              <Text size="xs" c="dimmed">
                {versionStates[group.state].note}
              </Text>
            </Group>

            <Stack gap="xs">
              <Group gap="xs">
                <Text fw={600} size="sm">
                  Pending
                </Text>
                <Badge variant="light">{group.pending.length}</Badge>
              </Group>
              {group.pending.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No rows of this version are awaiting a decision.
                </Text>
              ) : (
                /*
                  Every press is handed the group, which is where the version
                  half of a row's address comes from (1.2.4, 1.2.7). The tick,
                  the cross and the ambiguous value box are otherwise exactly
                  what they were.
                */
                <RuleRowsTable
                  rows={group.pending}
                  ambiguous={detail.ambiguous}
                  description={detail.description}
                  actions={{
                    onApprove: (row) => onRowApprove(group, row),
                    onDecline: (row) => onRowDecline(group, row),
                    onApproveWithValue: (row, value) => onRowApproveWithValue(group, row, value),
                    onDeclineWithReason: (row, reason) =>
                      onRowDeclineWithReason(group, row, reason),
                    busy,
                  }}
                />
              )}
            </Stack>

            <Stack gap="xs">
              <Group gap="xs">
                <Text fw={600} size="sm">
                  Approved
                </Text>
                <Badge variant="light" color="green">
                  {group.approved.length}
                </Badge>
              </Group>
              {group.approved.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Nothing of this version has been approved.
                </Text>
              ) : (
                /*
                  No tick and no cross here. An approved row is settled: there is
                  no undo (1.2.11, deferred.md D2), and the presses move only
                  rows that are still pending.
                */
                <RuleRowsTable
                  rows={group.approved}
                  ambiguous={detail.ambiguous}
                  description={detail.description}
                />
              )}
            </Stack>
          </Stack>
        ))
      )}

      {/*
        Guidance for the rule itself (1.5.1), on every rule and not only an
        ambiguous one: a rule that proposes the wrong value needs telling as
        much as one that proposes none. Keyed by what is stored, so a landed
        press re-seeds the box from the re-read.
      */}
      <Stack gap="xs">
        <Text fw={600} size="sm">
          Tell this rule what to do instead
        </Text>
        <RuleGuidance
          key={`${detail.guidanceVersion ?? 'none'}:${detail.guidance ?? ''}`}
          guidance={detail.guidance}
          queued={detail.queuedForRevision}
          canDecline={version !== null}
          busy={busy}
          onRevise={onRuleRevise}
          onDecline={onRuleDeclineWithReason}
        />
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
        {!detail.ambiguous && version !== null && (
          <>
            <Button color="green" onClick={onRuleApprove} disabled={busy || activePending === 0}>
              Approve rule (v{version})
            </Button>
            <Text size="xs" c="dimmed">
              {activePending === 0
                ? `Nothing is pending on v${version}.`
                : `Applies the ${rowCount(activePending)} pending on v${version}. Rows of any other version are decided one at a time.`}
            </Text>
          </>
        )}
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
          key={`${declining.address.table}:${declining.address.legacyId}:${declining.address.column}`}
          target={{ kind: 'row', ruleName: detail.ruleName, row: declining.row }}
          onCancel={() => setDeclining(null)}
          onConfirm={runDecline}
        />
      )}
    </Stack>
  );
}
