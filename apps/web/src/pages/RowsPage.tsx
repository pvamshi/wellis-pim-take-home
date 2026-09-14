import { useEffect, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Code,
  Container,
  Group,
  Loader,
  Pagination,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { ApiError, getRows, rowsUrl } from '../api/client';
import type { LegacySourceTable, RowListEntry, RowState } from '../api/types';
import { AppNav } from '../components/AppNav';
import { RowDetailPanel } from '../components/RowDetailPanel';

type RequestState =
  | { kind: 'loading' }
  | { kind: 'loaded'; rows: RowListEntry[]; total: number }
  | { kind: 'failed'; error: ApiError };

type TableFilter = 'all' | LegacySourceTable;
type StateFilter = 'all' | RowState;

/**
 * The page size `GET /rows` pages by, restated rather than imported
 * (`row-list.service.ts`'s own `ROWS_PAGE_SIZE`) — there is no shared package
 * between `apps/api` and `apps/web`. If the backend's constant ever changes
 * this one has to change with it by hand, the same risk every other restated
 * constant in this file already carries.
 */
const ROWS_PAGE_SIZE = 50;

/** The on-screen name for each state (1.6.1). */
const STATE_LABELS: Record<RowState, string> = {
  pending: 'Import pending',
  clean: 'Import clean',
  rejected: 'Import rejected',
};

const STATE_COLORS: Record<RowState, string> = {
  pending: 'yellow',
  clean: 'green',
  rejected: 'red',
};

const TABLE_FILTER_DATA = [
  { label: 'All', value: 'all' },
  { label: 'Patient', value: 'patient' },
  { label: 'Intake', value: 'intake' },
  { label: 'Consent', value: 'consent' },
];

const STATE_FILTER_DATA = [
  { label: 'All', value: 'all' },
  { label: STATE_LABELS.pending, value: 'pending' },
  { label: STATE_LABELS.clean, value: 'clean' },
  { label: STATE_LABELS.rejected, value: 'rejected' },
];

/**
 * The rows screen (1.6.1): every legacy row with its state, filterable to one
 * table and one state, paged; expanding a row mounts `RowDetailPanel`.
 *
 * Same `Container`/`Stack`/loading-loaded-failed shape `RulesPage` already
 * establishes, so the two screens read as one app. `keepMounted={false}` on
 * the `Accordion` is load-bearing, not styling, for the same reason it is on
 * the rules screen: an unmounted collapsed item means `GET
 * /rows/:table/:legacyId` fires only for a row that was actually opened.
 */
export function RowsPage() {
  const [state, setState] = useState<RequestState>({ kind: 'loading' });
  const [tableFilter, setTableFilter] = useState<TableFilter>('all');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    // Every rejection is handled here, so nothing escapes as an unhandled
    // promise rejection: a backend that is not running renders the Alert
    // below.
    getRows(
      {
        table: tableFilter === 'all' ? undefined : tableFilter,
        state: stateFilter === 'all' ? undefined : stateFilter,
        page,
      },
      controller.signal,
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'loaded', rows: response.rows, total: response.total });
      })
      .catch((cause: unknown) => {
        // An abort means this component went away; there is no one to tell.
        if (controller.signal.aborted) return;
        setState({
          kind: 'failed',
          error: cause instanceof ApiError ? cause : new ApiError(String(cause), null, rowsUrl),
        });
      });

    return () => controller.abort();
  }, [tableFilter, stateFilter, page, attempt]);

  function retry() {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }

  // A press inside an expanded row can change that row's state (1.6.2), so
  // the list is re-read after one lands. Not blanked to a spinner first —
  // the same reason `RulesPage.refresh` gives: that would collapse every
  // open row out from under the operator.
  function refresh() {
    setAttempt((n) => n + 1);
  }

  function onTableFilterChange(value: string) {
    setState({ kind: 'loading' });
    setTableFilter(value as TableFilter);
    setPage(1);
  }

  function onStateFilterChange(value: string) {
    setState({ kind: 'loading' });
    setStateFilter(value as StateFilter);
    setPage(1);
  }

  function onPageChange(value: number) {
    setState({ kind: 'loading' });
    setPage(value);
  }

  const totalPages =
    state.kind === 'loaded' ? Math.max(1, Math.ceil(state.total / ROWS_PAGE_SIZE)) : 1;

  return (
    <Container size="md" py="xl">
      <Stack gap="lg">
        <AppNav />

        <Stack gap={4}>
          <Title order={1}>Rows</Title>
          <Text size="sm" c="dimmed">
            Every legacy row, with its state (1.6.1).
          </Text>
        </Stack>

        <Group gap="lg" wrap="wrap">
          <SegmentedControl
            value={tableFilter}
            onChange={onTableFilterChange}
            data={TABLE_FILTER_DATA}
            aria-label="Filter by source table"
          />
          <SegmentedControl
            value={stateFilter}
            onChange={onStateFilterChange}
            data={STATE_FILTER_DATA}
            aria-label="Filter by state"
          />
        </Group>

        {state.kind === 'loading' && (
          <Group gap="sm">
            <Loader size="sm" />
            <Text>
              Calling <Code>{rowsUrl}</Code>
            </Text>
          </Group>
        )}

        {lastOutcome !== null && (
          <Alert
            color="blue"
            title="Last decision"
            withCloseButton
            onClose={() => setLastOutcome(null)}
          >
            <Text size="sm">{lastOutcome}</Text>
          </Alert>
        )}

        {state.kind === 'loaded' && state.rows.length === 0 && (
          <Text size="sm" c="dimmed">
            Nothing matches this filter.
          </Text>
        )}

        {state.kind === 'loaded' && state.rows.length > 0 && (
          <Accordion variant="separated" keepMounted={false}>
            {/* Keyed by table + legacy id, which cannot repeat within a table on this list. */}
            {state.rows.map((row) => (
              <Accordion.Item key={`${row.table}:${row.legacyId}`} value={`${row.table}:${row.legacyId}`}>
                <Accordion.Control>
                  <Group justify="space-between" wrap="nowrap" pr="sm">
                    <Group gap="xs" wrap="nowrap">
                      <Text fw={600}>{row.table}</Text>
                      <Code>{row.legacyId}</Code>
                    </Group>
                    <Badge variant="light" color={STATE_COLORS[row.state]}>
                      {STATE_LABELS[row.state]}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  {/*
                    Everything below is `RowDetailPanel`'s: it reads GET
                    /rows/:table/:legacyId when this item is expanded. This
                    page still issues exactly one request of its own, for the
                    list.

                    A press inside the panel is reported here and re-reads
                    the list, because a decision can change which state this
                    row is on — approving everything can move it to clean,
                    rejecting moves it to rejected regardless of findings
                    (1.6.2).
                  */}
                  <RowDetailPanel
                    table={row.table}
                    legacyId={row.legacyId}
                    initialRejected={row.state === 'rejected'}
                    onChanged={(outcome) => {
                      setLastOutcome(outcome);
                      refresh();
                    }}
                  />
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}

        {state.kind === 'loaded' && totalPages > 1 && (
          <Group justify="center">
            <Pagination value={page} onChange={onPageChange} total={totalPages} />
          </Group>
        )}

        {state.kind === 'failed' && (
          <Alert color="red" title="The rows could not be loaded">
            <Stack gap="xs">
              <Text size="sm">{state.error.message}</Text>
              {state.error.status !== null && (
                <Text size="sm">HTTP status: {state.error.status}</Text>
              )}
              <Text size="sm">
                URL tried: <Code>{state.error.url}</Code>
              </Text>
              <Group>
                <Button onClick={retry} color="red" variant="light">
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
