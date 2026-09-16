import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Chip,
  Code,
  Container,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { ApiError, getReviewQueue, reviewUrl } from '../api/client';
import type { IntakeStatus, PatientOrigin, ReviewQueueEntry } from '../api/types';
import { STATUS_COLORS, STATUS_LABELS } from '../intake/status';
import { AppNav } from '../components/AppNav';
import { useListTop } from '../useListTop';

type RequestState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly rows: ReviewQueueEntry[] }
  | { readonly kind: 'failed'; readonly error: ApiError };

type OriginFilter = 'all' | PatientOrigin;

/**
 * Every status this queue may be filtered to (2.4), the ticked three first.
 * The other five are offered rather than hidden: a patient a reviewer has
 * just decided on, or one still drafting, would otherwise be on no screen at
 * all.
 */
const QUEUE_STATUSES: readonly IntakeStatus[] = [
  'auto_flagged',
  'auto_cleared',
  'in_review',
  'auto_rejected',
  'draft',
  'submitted',
  'approved',
  'rejected',
];

const DEFAULT_STATUSES: readonly IntakeStatus[] = ['auto_flagged', 'auto_cleared', 'in_review'];

const ORIGIN_FILTER_DATA = [
  { label: 'All', value: 'all' },
  { label: 'Intake', value: 'intake' },
  { label: 'Legacy', value: 'legacy' },
];

const ROW_HEIGHT = 56;

function formatSubmitted(value: string | null): string {
  if (value === null) return '—';
  return new Date(value).toLocaleString();
}

/**
 * `/review` (2.4): one queue over both origins, virtualised, filtered by
 * status and origin. Each row opens `/review/:id`, its own route rather than
 * an inline expansion — unlike the rows screen, this screen's detail is
 * substantial enough (answers by step, every rule, a full history) to want a
 * page of its own.
 */
export function ReviewQueuePage() {
  const [state, setState] = useState<RequestState>({ kind: 'loading' });
  const [statuses, setStatuses] = useState<string[]>([...DEFAULT_STATUSES]);
  const [origin, setOrigin] = useState<OriginFilter>('all');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });

    getReviewQueue(
      {
        statuses: statuses as IntakeStatus[],
        origin: origin === 'all' ? undefined : origin,
      },
      controller.signal,
    )
      .then((rows) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'loaded', rows });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: 'failed',
          error: cause instanceof ApiError ? cause : new ApiError(String(cause), null, reviewUrl),
        });
      });

    return () => controller.abort();
  }, [statuses, origin, attempt]);

  const rows = state.kind === 'loaded' ? state.rows : [];
  // Scrolls with the page, like `RowsPage`.
  const list = useListTop<HTMLDivElement>();
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin: list.top,
  });

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <AppNav />

        <Stack gap={4}>
          <Title order={1}>Review</Title>
          <Text size="sm" c="dimmed">
            One queue for intake and legacy patients alike (2.4). Oldest first, by submission date —
            or by creation date for a draft, which has none.
          </Text>
        </Stack>

        <Group gap="lg" wrap="wrap" align="flex-end">
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Status
            </Text>
            <Chip.Group multiple value={statuses} onChange={setStatuses}>
              <Group gap="xs">
                {QUEUE_STATUSES.map((status) => (
                  <Chip key={status} value={status} size="sm">
                    {STATUS_LABELS[status]}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          </Stack>
          <SegmentedControl
            value={origin}
            onChange={(value) => setOrigin(value as OriginFilter)}
            data={ORIGIN_FILTER_DATA}
            aria-label="Filter by origin"
          />
        </Group>

        {state.kind === 'loading' && (
          <Group gap="sm">
            <Loader size="sm" />
            <Text size="sm">
              Calling <Code>{reviewUrl}</Code>
            </Text>
          </Group>
        )}

        {state.kind === 'loaded' && rows.length === 0 && (
          <Text size="sm" c="dimmed">
            Nothing matches this filter.
          </Text>
        )}

        {state.kind === 'loaded' && rows.length > 0 && (
          <>
            <Group gap="xl" px="sm" c="dimmed">
              <Text size="xs" fw={600} style={{ flex: '0 0 160px' }}>
                Submitted
              </Text>
              <Text size="xs" fw={600} style={{ flex: '0 0 70px' }}>
                Origin
              </Text>
              <Text size="xs" fw={600} style={{ flex: '0 0 40px' }}>
                Age
              </Text>
              <Text size="xs" fw={600} style={{ flex: '0 0 50px' }}>
                BMI
              </Text>
              <Text size="xs" fw={600} style={{ flex: '0 0 120px' }}>
                Status
              </Text>
              <Text size="xs" fw={600} style={{ flex: 1 }}>
                Matched
              </Text>
            </Group>

            <div ref={list.ref}>
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((item) => {
                  const row = rows[item.index];

                  return (
                    <Paper
                      key={row.id}
                      component={Link}
                      to={`/review/${row.id}`}
                      withBorder
                      p="sm"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        transform: `translateY(${item.start - list.top}px)`,
                        display: 'block',
                        color: 'inherit',
                        textDecoration: 'none',
                      }}
                    >
                      <Group gap="xl" wrap="nowrap">
                        <Text size="sm" style={{ flex: '0 0 160px' }}>
                          {formatSubmitted(row.submittedAt)}
                        </Text>
                        <Text size="sm" tt="capitalize" style={{ flex: '0 0 70px' }}>
                          {row.origin}
                        </Text>
                        <Text size="sm" style={{ flex: '0 0 40px' }}>
                          {row.age}
                        </Text>
                        <Text size="sm" style={{ flex: '0 0 50px' }}>
                          {row.bmi ?? '—'}
                        </Text>
                        <Badge
                          variant="light"
                          color={STATUS_COLORS[row.status]}
                          style={{ flex: '0 0 120px' }}
                        >
                          {STATUS_LABELS[row.status]}
                        </Badge>
                        <Group gap={4} wrap="wrap" style={{ flex: 1 }}>
                          {row.matchedRuleIds.length === 0 ? (
                            <Text size="xs" c="dimmed">
                              —
                            </Text>
                          ) : (
                            row.matchedRuleIds.map((ruleId) => (
                              <Badge key={ruleId} variant="outline" size="sm">
                                {ruleId}
                              </Badge>
                            ))
                          )}
                        </Group>
                      </Group>
                    </Paper>
                  );
                })}
              </div>
            </div>

            <Text size="xs" c="dimmed" ta="center">
              {rows.length} matching
            </Text>
          </>
        )}

        {state.kind === 'failed' && (
          <Alert color="red" title="The queue could not be loaded">
            <Stack gap="xs">
              <Text size="sm">{state.error.message}</Text>
              {state.error.status !== null && (
                <Text size="sm">HTTP status: {state.error.status}</Text>
              )}
              <Text size="sm">
                URL tried: <Code>{state.error.url}</Code>
              </Text>
              <Group>
                <Button color="red" variant="light" onClick={() => setAttempt((n) => n + 1)}>
                  Retry
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}
      </Stack>
    </Container>
  );
}
