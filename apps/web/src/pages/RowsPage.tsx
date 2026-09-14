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
 * How tall a collapsed row is assumed to be before it has been measured.
 *
 * Only a starting guess: every rendered item is measured for real, so this
 * decides how close the scrollbar is to the truth for rows nobody has scrolled
 * to yet, and nothing else. An expanded row is several times this, and is
 * measured like any other.
 */
const ESTIMATED_ROW_HEIGHT = 60;

/**
 * How much of the list is drawn, in pixels.
 *
 * The list scrolls inside this rather than down the document, because the
 * virtualiser has to own a scroll container to know what is on screen. Tall
 * enough that the filters and the heading stay put while a long list moves
 * under them.
 */
const LIST_HEIGHT = 640;

/**
 * How many rows one fetch asks for.
 *
 * Several screenfuls, so scrolling at a normal speed never catches up with the
 * fetching. Small enough that the first paint is not waiting on the whole
 * export: a fetch of everything is half a megabyte of JSON to show twenty rows.
 */
const FETCH_SIZE = 100;

/**
 * How close to the end of what is loaded the reader gets before the next fetch
 * starts. Roughly a screenful, so the rows arrive before they are looked at.
 */
const PREFETCH_WITHIN = 20;

/** A stable empty array, so the virtualiser is not rebuilt on every render. */
const EMPTY_ROWS: RowListEntry[] = [];

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
 * table and one state, virtualised; expanding a row mounts `RowDetailPanel`.
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
  const [attempt, setAttempt] = useState(0);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);
  /**
   * True while a further window is in flight.
   *
   * A ref and not state, because it is read inside the scroll effect to decide
   * whether to start another fetch: as state it would be a render behind, and
   * a fast scroll would fire the same fetch several times before the first
   * render carrying `true` arrived.
   */
  const fetchingMore = useRef(false);

  const narrowing = {
    table: tableFilter === 'all' ? undefined : tableFilter,
    state: stateFilter === 'all' ? undefined : stateFilter,
  };

  // The first window. Runs again whenever a filter changes or the list is
  // re-read after a press, and always starts from the top — a different filter
  // is a different list, and nothing of the old one is kept.
  useEffect(() => {
    const controller = new AbortController();
    fetchingMore.current = false;

    // Every rejection is handled here, so nothing escapes as an unhandled
    // promise rejection: a backend that is not running renders the Alert
    // below.
    getRows({ ...narrowing, offset: 0, limit: FETCH_SIZE }, controller.signal)
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
  }, [tableFilter, stateFilter, attempt]);

  /**
   * The next window, appended to what is already loaded.
   *
   * Appending rather than replacing is what makes the scrollbar honest: the
   * virtualiser sizes itself from how many rows it has been given, so a fetch
   * that swapped one window for another would make the list jump to a different
   * length under a reader who was only scrolling.
   *
   * A failed fetch here is deliberately quiet — it leaves what is loaded on
   * screen and lets the next scroll try again, rather than replacing a working
   * list with an error over a window nobody explicitly asked for.
   */
  function loadMore(loaded: number) {
    fetchingMore.current = true;

    getRows({ ...narrowing, offset: loaded, limit: FETCH_SIZE })
      .then((response) => {
        setState((previous) =>
          previous.kind === 'loaded'
            ? { ...previous, rows: [...previous.rows, ...response.rows], total: response.total }
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
  }

  function onStateFilterChange(value: string) {
    setState({ kind: 'loading' });
    setStateFilter(value as StateFilter);
  }

  /**
   * The list, virtualised.
   *
   * `GET /rows` answers with the whole filtered set — 2466 patients unfiltered
   * — and only the items on screen are rendered. Hooks cannot be called
   * conditionally, so the row array is empty except in the loaded state and the
   * virtualiser is built on every render regardless.
   *
   * `measureElement` measures each item as it is drawn rather than trusting the
   * estimate, which is what makes this work on an accordion at all: an expanded
   * row is many times the height of a collapsed one, and expanding one must not
   * push every row below it out of place.
   */
  const rows = state.kind === 'loaded' ? state.rows : EMPTY_ROWS;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 8,
  });

  const visible = virtualizer.getVirtualItems();

  // Two spacers rather than absolute positioning, so the accordion's own
  // `separated` spacing and its focus order are the ones Mantine draws.
  const above = visible.length > 0 ? visible[0].start : 0;
  const below =
    visible.length > 0 ? virtualizer.getTotalSize() - visible[visible.length - 1].end : 0;

  // Fetch the next window when the reader gets within a screenful of the end of
  // what is loaded. Driven by what the virtualiser is drawing rather than by a
  // scroll handler, because that is already the answer to "how far down is
  // this reader" and a scroll listener would be a second, coarser one.
  const total = state.kind === 'loaded' ? state.total : 0;
  const lastVisible = visible.length > 0 ? visible[visible.length - 1].index : 0;

  useEffect(() => {
    if (fetchingMore.current) return;
    if (rows.length === 0 || rows.length >= total) return;
    if (lastVisible < rows.length - 1 - PREFETCH_WITHIN) return;

    loadMore(rows.length);
  }, [lastVisible, rows.length, total]);

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
          <div ref={scrollRef} style={{ height: LIST_HEIGHT, overflowY: 'auto' }}>
            <Accordion variant="separated" keepMounted={false}>
              {above > 0 && <div style={{ height: above }} />}
              {/* Keyed by table + legacy id, which cannot repeat within a table on this list. */}
              {visible.map((item) => {
                const row = rows[item.index];

                return (
                  <Accordion.Item
                    key={`${row.table}:${row.legacyId}`}
                    value={`${row.table}:${row.legacyId}`}
                    ref={virtualizer.measureElement}
                    data-index={item.index}
                  >
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
                );
              })}
              {below > 0 && <div style={{ height: below }} />}
            </Accordion>
          </div>
        )}

        {state.kind === 'loaded' && state.rows.length > 0 && (
          // What is on screen is a window of a longer list, and the reader is
          // owed the size of the list rather than the size of the window —
          // "100 of 2466" is a different screen from "100".
          <Text size="xs" c="dimmed" ta="center">
            {state.rows.length === state.total
              ? `${state.total} matching`
              : `${state.rows.length} of ${state.total} matching loaded — scroll for more`}
          </Text>
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
