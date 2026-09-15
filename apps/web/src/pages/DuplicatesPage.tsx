import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Code,
  Container,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ApiError, duplicatesUrl, getDuplicates } from '../api/client';
import type { DuplicateListEntry, DuplicateStatus, LegacySourceTable } from '../api/types';
import { AppNav } from '../components/AppNav';
import { DuplicateDetailPanel } from '../components/DuplicateDetailPanel';

type RequestState =
  | { kind: 'loading' }
  | { kind: 'loaded'; links: DuplicateListEntry[]; total: number }
  | { kind: 'failed'; error: ApiError };

type TableFilter = 'all' | LegacySourceTable;
type StatusFilter = 'all' | DuplicateStatus;

/** How tall a collapsed link is assumed to be before it has been measured. */
const ESTIMATED_ROW_HEIGHT = 60;

/** How much of the list is drawn, in pixels — `RowsPage`'s own constant. */
const LIST_HEIGHT = 640;

/** How many links one fetch asks for — `RowsPage`'s own constant. */
const FETCH_SIZE = 100;

/** How close to the end of what is loaded the reader gets before the next fetch starts. */
const PREFETCH_WITHIN = 20;

/** A stable empty array, so the virtualiser is not rebuilt on every render. */
const EMPTY_LINKS: DuplicateListEntry[] = [];

/** The on-screen name for each status (1.7.3). */
const STATUS_LABELS: Record<DuplicateStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  dismissed: 'Dismissed',
};

const STATUS_COLORS: Record<DuplicateStatus, string> = {
  pending: 'yellow',
  confirmed: 'green',
  dismissed: 'gray',
};

const TABLE_FILTER_DATA = [
  { label: 'All', value: 'all' },
  { label: 'Patient', value: 'patient' },
  { label: 'Intake', value: 'intake' },
  { label: 'Consent', value: 'consent' },
];

const STATUS_FILTER_DATA = [
  { label: 'All', value: 'all' },
  { label: STATUS_LABELS.pending, value: 'pending' },
  { label: STATUS_LABELS.confirmed, value: 'confirmed' },
  { label: STATUS_LABELS.dismissed, value: 'dismissed' },
];

/**
 * The duplicates screen (1.7.4): every link the current filter matches,
 * pending by default, filterable by source and status, virtualised.
 * Expanding a link mounts `DuplicateDetailPanel`.
 *
 * A structural copy of `RowsPage`, the same reason `RowsPage` itself reads as
 * one app with `RulesPage`: same `Container`/`Stack`/loading-loaded-failed
 * shape, same windowed-fetch-with-prefetch machinery, same
 * `keepMounted={false}` — load-bearing here for the same reason it is there,
 * so an unmounted collapsed link means `GET /duplicates/:id` fires only for a
 * link someone actually opened.
 */
export function DuplicatesPage() {
  const [state, setState] = useState<RequestState>({ kind: 'loading' });
  const [tableFilter, setTableFilter] = useState<TableFilter>('all');
  // Pending by default (1.7.4's own words) — unlike `RowsPage`'s table filter,
  // whose "no stated default" reading is "show everything".
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [attempt, setAttempt] = useState(0);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);
  /** True while a further window is in flight — a ref for the same reason `RowsPage`'s is. */
  const fetchingMore = useRef(false);

  const narrowing = {
    table: tableFilter === 'all' ? undefined : tableFilter,
    status: statusFilter === 'all' ? undefined : statusFilter,
  };

  // The first window. Runs again whenever a filter changes or the list is
  // re-read after a press, and always starts from the top.
  useEffect(() => {
    const controller = new AbortController();
    fetchingMore.current = false;

    getDuplicates({ ...narrowing, offset: 0, limit: FETCH_SIZE }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'loaded', links: response.links, total: response.total });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: 'failed',
          error: cause instanceof ApiError ? cause : new ApiError(String(cause), null, duplicatesUrl),
        });
      });

    return () => controller.abort();
  }, [tableFilter, statusFilter, attempt]);

  /** The next window, appended to what is already loaded — `RowsPage.loadMore`'s own shape. */
  function loadMore(loaded: number) {
    fetchingMore.current = true;

    getDuplicates({ ...narrowing, offset: loaded, limit: FETCH_SIZE })
      .then((response) => {
        setState((previous) =>
          previous.kind === 'loaded'
            ? { ...previous, links: [...previous.links, ...response.links], total: response.total }
            : previous,
        );
      })
      .catch(() => undefined)
      .finally(() => {
        fetchingMore.current = false;
      });
  }

  function retry() {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }

  // A press inside an expanded link moves its status off `pending` (1.7.3), so
  // the list is re-read after one lands. Not blanked to a spinner first — the
  // same reason `RowsPage.refresh` gives: that would collapse every open link
  // out from under the operator.
  function refresh() {
    setAttempt((n) => n + 1);
  }

  function onTableFilterChange(value: string) {
    setState({ kind: 'loading' });
    setTableFilter(value as TableFilter);
  }

  function onStatusFilterChange(value: string) {
    setState({ kind: 'loading' });
    setStatusFilter(value as StatusFilter);
  }

  const links = state.kind === 'loaded' ? state.links : EMPTY_LINKS;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: links.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 8,
  });

  const visible = virtualizer.getVirtualItems();
  const above = visible.length > 0 ? visible[0].start : 0;
  const below =
    visible.length > 0 ? virtualizer.getTotalSize() - visible[visible.length - 1].end : 0;

  const total = state.kind === 'loaded' ? state.total : 0;
  const lastVisible = visible.length > 0 ? visible[visible.length - 1].index : 0;

  useEffect(() => {
    if (fetchingMore.current) return;
    if (links.length === 0 || links.length >= total) return;
    if (lastVisible < links.length - 1 - PREFETCH_WITHIN) return;

    loadMore(links.length);
  }, [lastVisible, links.length, total]);

  return (
    <Container size="md" py="xl">
      <Stack gap="lg">
        <AppNav />

        <Stack gap={4}>
          <Title order={1}>Duplicates</Title>
          <Text size="sm" c="dimmed">
            Links between rows found by the duplicate rules (1.7.4).
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
            value={statusFilter}
            onChange={onStatusFilterChange}
            data={STATUS_FILTER_DATA}
            aria-label="Filter by status"
          />
        </Group>

        {state.kind === 'loading' && (
          <Group gap="sm">
            <Loader size="sm" />
            <Text>
              Calling <Code>{duplicatesUrl}</Code>
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

        {state.kind === 'loaded' && state.links.length === 0 && (
          <Text size="sm" c="dimmed">
            Nothing matches this filter.
          </Text>
        )}

        {state.kind === 'loaded' && state.links.length > 0 && (
          <div ref={scrollRef} style={{ height: LIST_HEIGHT, overflowY: 'auto' }}>
            <Accordion variant="separated" keepMounted={false}>
              {above > 0 && <div style={{ height: above }} />}
              {/* Keyed by the link's own generated id (1.7.1) — it has no natural key. */}
              {visible.map((item) => {
                const link = links[item.index];

                return (
                  <Accordion.Item
                    key={link.id}
                    value={link.id}
                    ref={virtualizer.measureElement}
                    data-index={item.index}
                  >
                    <Accordion.Control>
                      <Group justify="space-between" wrap="nowrap" pr="sm">
                        <Group gap="xs" wrap="nowrap">
                          <Text fw={600}>{link.table}</Text>
                          <Code>{link.duplicateLegacyId}</Code>
                          <Text c="dimmed">→</Text>
                          <Code>{link.canonicalLegacyId}</Code>
                          <Text size="sm" c="dimmed">
                            {link.ruleName}
                          </Text>
                        </Group>
                        <Badge variant="light" color={STATUS_COLORS[link.status]}>
                          {STATUS_LABELS[link.status]}
                        </Badge>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      {/*
                        Everything below is `DuplicateDetailPanel`'s: it reads
                        GET /duplicates/:id when this item is expanded. This
                        page still issues exactly one request of its own, for
                        the list.
                      */}
                      <DuplicateDetailPanel
                        id={link.id}
                        onChanged={(outcome) => {
                          setLastOutcome(outcome);
                          refresh();
                        }}
                      />
                    </Accordion.Panel>
                  </Accordion.Item>
                );
              })}
              {below > 0 && <div style={{ height: below }} />}
            </Accordion>
          </div>
        )}

        {state.kind === 'loaded' && state.links.length > 0 && (
          <Text size="xs" c="dimmed" ta="center">
            {state.links.length === state.total
              ? `${state.total} matching`
              : `${state.links.length} of ${state.total} matching loaded — scroll for more`}
          </Text>
        )}

        {state.kind === 'failed' && (
          <Alert color="red" title="The duplicates could not be loaded">
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
