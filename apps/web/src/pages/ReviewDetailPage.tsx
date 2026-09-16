import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Code,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import {
  ApiError,
  decideReview,
  getReviewDetail,
  reviewIntakeUrl,
  startReview,
} from '../api/client';
import type { AuditEvent, EvaluationEntry, ReviewDetail } from '../api/types';
import { AnswerGroups } from '../components/review/AnswerGroups';
import { AppNav } from '../components/AppNav';
import { getStoredStaffName, setStoredStaffName } from '../staffName';
import { STATUS_COLORS, STATUS_LABELS } from '../intake/status';

type RequestState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly detail: ReviewDetail }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly error: ApiError };

const AUTO_STATUSES = new Set(['auto_cleared', 'auto_flagged', 'auto_rejected']);

function formatAt(value: string): string {
  return new Date(value).toLocaleString();
}

const ACTION_LABELS: Record<AuditEvent['action'], string> = {
  create: 'Created',
  import: 'Imported',
  transition: 'Moved',
  decision: 'Decided',
};

function HistoryRow({ event }: { readonly event: AuditEvent }) {
  return (
    <Table.Tr>
      <Table.Td>{formatAt(event.at)}</Table.Td>
      <Table.Td>{ACTION_LABELS[event.action]}</Table.Td>
      <Table.Td>
        {event.fromState ?? '—'} → {event.toState ?? '—'}
      </Table.Td>
      <Table.Td>{event.actor}</Table.Td>
      <Table.Td>{event.reason ?? '—'}</Table.Td>
    </Table.Tr>
  );
}

function EvaluationRow({ entry }: { readonly entry: EvaluationEntry }) {
  return (
    <Table.Tr>
      <Table.Td>
        <Code>{entry.ruleId}</Code>
      </Table.Td>
      <Table.Td>
        <Badge variant={entry.matched ? 'filled' : 'light'} color={entry.matched ? 'red' : 'gray'}>
          {entry.matched ? 'Matched' : 'Clear'}
        </Badge>
      </Table.Td>
      <Table.Td tt="capitalize">{entry.outcome}</Table.Td>
      <Table.Td>{entry.explanation}</Table.Td>
    </Table.Tr>
  );
}

/**
 * `/review/:id` (2.4): answers by step, every rule's own result, status
 * history, and the two presses that move a row through review.
 *
 * The screen's truth is always a fresh read: after Start review, Approve or
 * Reject lands, the detail is re-read rather than patched locally from the
 * press's own report — the same rule every panel elsewhere in this app
 * follows (`RowDetailPanel`, `RuleDetailPanel`).
 */
export function ReviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<RequestState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [reviewer, setReviewer] = useState(() => getStoredStaffName());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (id === undefined) return;

    const controller = new AbortController();
    setState({ kind: 'loading' });

    getReviewDetail(id, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'loaded', detail });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 404) {
          setState({ kind: 'not-found' });
          return;
        }
        setState({
          kind: 'failed',
          error:
            cause instanceof ApiError
              ? cause
              : new ApiError(String(cause), null, reviewIntakeUrl(id)),
        });
      });

    return () => controller.abort();
  }, [id, attempt]);

  function onReviewerChange(value: string) {
    setReviewer(value);
    setStoredStaffName(value);
  }

  function refresh() {
    setAttempt((n) => n + 1);
  }

  function onStart() {
    if (id === undefined) return;
    const actor = reviewer.trim();
    if (actor === '') return;

    setBusy(true);
    setActionError(null);

    startReview(id, actor)
      .then((outcome) => {
        if (outcome.outcome === 'conflict') {
          setActionError(
            new ApiError(
              'This row is no longer awaiting review.',
              409,
              reviewIntakeUrl(id, '/start'),
            ),
          );
          refresh();
          return;
        }
        refresh();
      })
      .catch((cause: unknown) => {
        setActionError(
          cause instanceof ApiError
            ? cause
            : new ApiError(String(cause), null, reviewIntakeUrl(id)),
        );
      })
      .finally(() => setBusy(false));
  }

  function onDecide(decision: 'approved' | 'rejected') {
    if (id === undefined) return;
    const actor = reviewer.trim();
    const trimmedNote = note.trim();
    if (actor === '' || trimmedNote === '') return;

    setBusy(true);
    setActionError(null);

    decideReview(id, decision, trimmedNote, actor)
      .then((outcome) => {
        if (outcome.outcome === 'conflict') {
          setActionError(
            new ApiError('This row is no longer in review.', 409, reviewIntakeUrl(id, '/decide')),
          );
          refresh();
          return;
        }
        if (outcome.outcome === 'invalid') {
          setActionError(
            new ApiError(
              outcome.errors[0]?.reason ?? 'The note is required.',
              422,
              reviewIntakeUrl(id, '/decide'),
            ),
          );
          return;
        }
        setNote('');
        refresh();
      })
      .catch((cause: unknown) => {
        setActionError(
          cause instanceof ApiError
            ? cause
            : new ApiError(String(cause), null, reviewIntakeUrl(id)),
        );
      })
      .finally(() => setBusy(false));
  }

  return (
    <Container size="md" py="xl">
      <Stack gap="lg">
        <AppNav />

        <Group justify="space-between" wrap="wrap">
          <Stack gap={4}>
            <Title order={1}>Review</Title>
            <Text size="sm" c="dimmed">
              {/* Back to the tab this patient is actually on (2.4): an intake
                  patient is not on `/review`, so a fixed link would land the
                  reviewer on a list their patient is missing from. */}
              <Anchor
                component={Link}
                to={
                  state.kind === 'loaded' && state.detail.origin === 'intake'
                    ? '/intakes'
                    : '/review'
                }
              >
                Back to the queue
              </Anchor>
            </Text>
          </Stack>
          <TextInput
            label="Your name"
            placeholder="Reviewer"
            value={reviewer}
            onChange={(event) => onReviewerChange(event.currentTarget.value)}
            description="Kept on this device, sent as the actor on every action."
          />
        </Group>

        {state.kind === 'loading' && (
          <Group gap="sm">
            <Loader size="sm" />
            <Text size="sm">Loading…</Text>
          </Group>
        )}

        {state.kind === 'not-found' && (
          <Alert color="red" title="There is no intake at this address" />
        )}

        {state.kind === 'failed' && (
          <Alert color="red" title="This row could not be loaded">
            <Stack gap="xs">
              <Text size="sm">{state.error.message}</Text>
              <Group>
                <Button color="red" variant="light" onClick={refresh}>
                  Retry
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}

        {state.kind === 'loaded' && (
          <Stack gap="xl">
            {actionError !== null && (
              <Alert
                color="red"
                title="That press did not land"
                withCloseButton
                onClose={() => setActionError(null)}
              >
                <Text size="sm">{actionError.message}</Text>
              </Alert>
            )}

            <Group gap="md" wrap="wrap">
              <Badge size="lg" variant="light" color={STATUS_COLORS[state.detail.status]}>
                {STATUS_LABELS[state.detail.status]}
              </Badge>
              <Text size="sm" tt="capitalize">
                {state.detail.origin}
              </Text>
              <Text size="sm">Age {state.detail.age}</Text>
              <Text size="sm" c="dimmed">
                Submitted{' '}
                {state.detail.submittedAt === null ? '—' : formatAt(state.detail.submittedAt)}
              </Text>
              {state.detail.decidedAt !== null && (
                <Text size="sm" c="dimmed">
                  Decided {formatAt(state.detail.decidedAt)}
                </Text>
              )}
            </Group>

            <Stack gap="xs">
              <Title order={3}>Answers</Title>
              <AnswerGroups answers={state.detail.answers} />
            </Stack>

            <Stack gap="xs">
              <Title order={3}>Evaluation</Title>
              <Text size="sm" c="dimmed">
                Ruleset {state.detail.evaluation.rulesetVersion ?? '—'}
              </Text>
              {state.detail.evaluation.results.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Not evaluated.
                </Text>
              ) : (
                <Table.ScrollContainer minWidth={480}>
                  <Table striped withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Rule</Table.Th>
                        <Table.Th>Result</Table.Th>
                        <Table.Th>Category</Table.Th>
                        <Table.Th>Explanation</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {state.detail.evaluation.results.map((entry) => (
                        <EvaluationRow key={entry.ruleId} entry={entry} />
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Stack>

            <Stack gap="xs">
              <Title order={3}>Status history</Title>
              <Table.ScrollContainer minWidth={480}>
                <Table striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>At</Table.Th>
                      <Table.Th>Action</Table.Th>
                      <Table.Th>Transition</Table.Th>
                      <Table.Th>Actor</Table.Th>
                      <Table.Th>Reason</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {state.detail.history.map((event) => (
                      <HistoryRow key={event.id} event={event} />
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Stack>

            <Stack gap="sm">
              <Title order={3}>Decide</Title>

              {AUTO_STATUSES.has(state.detail.status) && (
                <Group>
                  <Button onClick={onStart} loading={busy} disabled={reviewer.trim() === ''}>
                    Start review
                  </Button>
                  {reviewer.trim() === '' && (
                    <Text size="sm" c="dimmed">
                      Enter your name above first.
                    </Text>
                  )}
                </Group>
              )}

              {state.detail.status === 'in_review' && (
                <Stack gap="sm">
                  <Textarea
                    label="Note"
                    description="Required to approve or reject."
                    autosize
                    minRows={2}
                    value={note}
                    onChange={(event) => setNote(event.currentTarget.value)}
                    disabled={busy}
                  />
                  <Group>
                    <Button
                      color="teal"
                      onClick={() => onDecide('approved')}
                      loading={busy}
                      disabled={note.trim() === '' || reviewer.trim() === ''}
                    >
                      Approve
                    </Button>
                    <Button
                      color="red"
                      variant="light"
                      onClick={() => onDecide('rejected')}
                      loading={busy}
                      disabled={note.trim() === '' || reviewer.trim() === ''}
                    >
                      Reject
                    </Button>
                  </Group>
                </Stack>
              )}

              {!AUTO_STATUSES.has(state.detail.status) && state.detail.status !== 'in_review' && (
                <Text size="sm" c="dimmed">
                  This row is settled — no further action.
                </Text>
              )}
            </Stack>
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
