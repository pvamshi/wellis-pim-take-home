import { useState } from 'react';
import { Alert, Button, Checkbox, Code, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import type { RuleDetailRow } from '../api/types';

/**
 * Which cross was pressed: the one on the rule, or the one on a row.
 *
 * The row itself is carried rather than its address, because everything this
 * dialog does with it is show it back to the reader — which row they are about
 * to decide. The address is the panel's, and so is the press.
 */
export type DeclineDialogTarget =
  | { readonly kind: 'rule'; readonly ruleName: string }
  | { readonly kind: 'row'; readonly ruleName: string; readonly row: RuleDetailRow };

/** What the operator decided: the reason they typed, and whether they ticked. */
export interface DeclineDecision {
  /**
   * Exactly as typed. Blank means no reason, which the client encodes.
   *
   * Empty whenever no reason box was shown — an unticked row cross — because
   * that press stores none.
   */
  readonly reason: string;
  /** 1.2.8's tick. Always false for a rule-level decline, which has no tick. */
  readonly modifyRule: boolean;
}

export interface DeclineDialogProps {
  readonly target: DeclineDialogTarget;
  readonly onCancel: () => void;
  readonly onConfirm: (decision: DeclineDecision) => void;
}

/**
 * The reason box, and the "modify the rule" tick on a row (1.2.6, 1.2.8).
 *
 * It holds the two answers and nothing else: it issues no request, knows no
 * URL, and decides nothing about what happens next. The panel that opened it
 * turns the answers into one of three presses.
 *
 * Three things the code does not say on its own:
 *
 * - **The tick chooses a route, not a field.** It is handed back as
 *   `modifyRule` and the client sends it nowhere: unticked posts to the route
 *   that declines the row, ticked posts to the route that parks the rule. The
 *   backend serves two routes precisely so that no boolean from a screen can
 *   decide which table is written, and collapsing them here would undo that.
 * - **The two branches of the row cross are opposite, so the copy says which.**
 *   Unticked settles this row forever and leaves the rule running (1.2.7,
 *   1.2.9); ticked leaves this row pending and stops the rule (1.2.8). The
 *   operator picks between them here, so this is where the consequence has to
 *   be readable.
 * - **The reason box is shown where the reason is stored.** That is the press
 *   that parks a version: Decline on the rule (1.2.6), and the ticked cross
 *   (1.2.8). An unticked cross is the row-level reason of 1.2.7, which this
 *   screen does not yet collect, so it is asked for nothing it would drop.
 * - **The reason is always optional.** Nothing is required to confirm, and a
 *   box left empty records no reason at all (1.2.6, second scenario) rather
 *   than storing a blank.
 */
export function DeclineDialog({ target, onCancel, onConfirm }: DeclineDialogProps) {
  const [reason, setReason] = useState('');
  const [modifyRule, setModifyRule] = useState(false);

  // Only a row cross can be ticked, so only a row cross can be a revision.
  const revising = target.kind === 'row' && modifyRule;
  // The two presses that park a version are the two that store a reason
  // (1.2.6, 1.2.8), and so the two that ask for one.
  const asksForReason = target.kind === 'rule' || revising;

  return (
    <Modal
      opened
      centered
      onClose={onCancel}
      title={target.kind === 'rule' ? `Decline ${target.ruleName}` : 'Cross out one row'}
    >
      <Stack gap="md">
        {target.kind === 'row' && (
          <Text size="sm">
            <Code>{target.row.table}</Code> <Code>{target.row.legacyId}</Code>, column{' '}
            <Code>{target.row.column}</Code>, proposed by {target.ruleName}.
          </Text>
        )}

        {target.kind === 'rule' && (
          <Text size="sm">
            The rule&rsquo;s active version is parked for revision: it goes inactive and leaves this
            screen until a new version is written. Its pending rows stay pending — nothing here
            decides a row.
          </Text>
        )}

        {target.kind === 'row' && !revising && (
          <Text size="sm">
            This row is declined forever: no version of {target.ruleName} will ever propose on it
            again. The rule itself keeps running and its other rows stay approvable.
          </Text>
        )}

        {revising && (
          <Alert color="yellow" title="The rule goes for revision">
            <Text size="sm">
              This row is <strong>not</strong> declined — it stays pending, so the version that
              replaces {target.ruleName} proposes on the very row that exposed the problem. What
              stops instead is the rule: its active version goes inactive and is queued for
              revision, taking every one of its pending rows off this screen with it.
            </Text>
          </Alert>
        )}

        {target.kind === 'row' && (
          <Checkbox
            label="Modify the rule"
            description="Tick this when the rule is wrong and this row is the evidence."
            checked={modifyRule}
            onChange={(event) => setModifyRule(event.currentTarget.checked)}
          />
        )}

        {/*
          Below the tick, because on a row it is the tick that brings it: a
          reason is stored only by the press that parks a version (1.2.6,
          1.2.8), so an unticked cross is asked for nothing.
        */}
        {asksForReason && (
          <Textarea
            label="Reason"
            description="Optional. Stored against the rule version, for whoever writes the next one."
            placeholder="What is wrong with it?"
            autosize
            minRows={3}
            maxRows={8}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            data-autofocus
          />
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            color={revising ? 'yellow' : 'red'}
            // A reason typed while ticked, then unticked away, is not sent:
            // the press that follows stores none, and handing it back would be
            // an answer to a question that is no longer on the screen.
            onClick={() => onConfirm({ reason: asksForReason ? reason : '', modifyRule })}
          >
            {target.kind === 'rule'
              ? 'Decline rule'
              : revising
                ? 'Send the rule for revision'
                : 'Decline row'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
