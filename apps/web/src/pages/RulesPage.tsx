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
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { ApiError, applyRules, applyRulesUrl, getRules, rulesUrl } from '../api/client';
import type { ApplyRulesTotals, RuleListEntry } from '../api/types';
import { AppNav } from '../components/AppNav';
import { RuleDetailPanel } from '../components/RuleDetailPanel';

type RequestState =
  | { kind: 'loading' }
  | { kind: 'loaded'; rules: RuleListEntry[] }
  | { kind: 'failed'; error: ApiError };

/** How many of a thing, in words that read the same for one as for many. */
function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/**
 * What a run did, in one line, built from the endpoint's totals and nothing
 * else.
 *
 * The counters reconcile — `found = declined + repeated + written` — so this
 * reads as one sentence about one number rather than four unrelated figures.
 * A run that called nothing is its own sentence: zero of everything is true but
 * says nothing about why, and "no active version" is the only way it happens.
 */
function runSummary(totals: ApplyRulesTotals): string {
  if (totals.versionsRun === 0) {
    return 'No rule version is active, so nothing ran and nothing was found.';
  }

  return (
    `Ran ${plural(totals.versionsRun, 'rule version', 'rule versions')} against the whole dataset: ` +
    `${plural(totals.found, 'finding', 'findings')} — ${totals.written} written as new pending ` +
    `rows, ${totals.repeated} already recorded, ${totals.declined} skipped as declined.`
  );
}

/** One of the screen's two lists, under its heading. */
interface RuleSection {
  readonly key: string;
  /** Null for the first list, which the page title already names. */
  readonly heading: string | null;
  readonly note: string;
  readonly rules: RuleListEntry[];
}

/**
 * The rules with work waiting, then the rules whose changes are all applied,
 * then the rules waiting to be rewritten (1.2.1, 1.5.1).
 */
function sections(rules: RuleListEntry[]): RuleSection[] {
  const queued = rules.filter((rule) => rule.queuedForRevision);
  const live = rules.filter((rule) => !rule.queuedForRevision);

  return [
    { key: 'work', heading: null, note: '', rules: live.filter((rule) => rule.pending > 0) },
    {
      key: 'applied',
      heading: 'Applied',
      note: 'Nothing left to decide. Open a rule to see every change it made.',
      rules: live.filter((rule) => rule.pending === 0),
    },
    {
      key: 'revision',
      heading: 'Sent for revision',
      note: 'Parked until a new version is written. Open one to read or refine the guidance it was given.',
      rules: queued,
    },
  ];
}

/**
 * The rules screen (1.2.1): every rule whose active version has rows waiting
 * for a decision, most first, then the rules whose changes are all applied,
 * each expandable.
 *
 * The list is rendered in the order `GET /rules` hands it over — no sort, and
 * no line dropped; the page only splits it in two. That behaviour is the endpoint's (T5.1)
 * and is tested there; repeating it here would create a second definition of
 * 1.2.1 that could quietly disagree with the first.
 *
 * The loading/loaded/failed machine is written out here rather than extracted
 * into a shared hook. `HealthPage` has the same shape and the two are allowed
 * to stay separate until a third page makes the abstraction worth naming.
 */
export function RulesPage() {
  const [state, setState] = useState<RequestState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);
  // The run: whether one is in flight, what the last one did, and why the last
  // one did not finish. Separate from `lastOutcome`, which is about a decision.
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [runError, setRunError] = useState<ApiError | null>(null);
  // Bumped by a finished run, and part of every open panel's key, which is how
  // the rows inside an expanded rule are re-read as well as the list.
  const [runs, setRuns] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    // Every rejection is handled here, so nothing escapes as an unhandled
    // promise rejection: a backend that is not running renders the Alert below.
    getRules(controller.signal)
      .then((rules) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'loaded', rules });
      })
      .catch((cause: unknown) => {
        // An abort means this component went away; there is no one to tell.
        if (controller.signal.aborted) return;
        setState({
          kind: 'failed',
          error: cause instanceof ApiError ? cause : new ApiError(String(cause), null, rulesUrl),
        });
      });

    return () => controller.abort();
  }, [attempt]);

  // Bumping the attempt counter re-runs the effect. The loading state is set
  // here rather than in the effect body, where a synchronous setState would
  // cascade an extra render.
  function retry() {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }

  // The same re-read without the loading state. A press inside an expanded rule
  // changes what belongs on this list — a rule with nothing left pending leaves
  // it (1.2.1) — but blanking the list to a spinner would collapse the
  // accordion under the user's hands, so the rows are replaced when the new
  // ones arrive and the screen does not flicker in between.
  function refresh() {
    setAttempt((n) => n + 1);
  }

  /**
   * "Apply rules" (1.2.10): every active rule version runs against the entire
   * dataset, then the screen refreshes from the results.
   *
   * Four things the code does not say on its own:
   *
   * - **The press sends nothing.** Which rules run is decided by `rule_version`
   *   rows, so no state on this screen can narrow a run.
   * - **The refresh is both halves of the screen.** `refresh()` re-reads the
   *   list, and the run counter in each panel's key remounts an expanded rule so
   *   its rows are re-read too. A list-only refresh would leave an open rule
   *   showing what it held before the run.
   * - **The report is never written into state.** It builds the line below and
   *   nothing else; the rows come from the re-read, as they do after every other
   *   press on this screen.
   * - **A failed run refreshes nothing and claims nothing.** A response can be
   *   lost after a run that already committed, so the alert says only that the
   *   screen was not refreshed. Pressing again is safe: a repeat run records
   *   nothing new.
   */
  function onApplyRules() {
    setRunning(true);
    setRunError(null);
    // The last decision described the state before this run, so it goes.
    setLastOutcome(null);

    applyRules()
      .then((report) => {
        setLastRun(runSummary(report.totals));
        setRuns((n) => n + 1);
        refresh();
      })
      .catch((cause: unknown) => {
        setRunError(
          cause instanceof ApiError ? cause : new ApiError(String(cause), null, applyRulesUrl),
        );
      })
      .finally(() => setRunning(false));
  }

  return (
    <Container size="md" py="xl">
      <Stack gap="lg">
        <AppNav />

        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={4}>
            <Title order={1}>Rules</Title>
            <Text size="sm" c="dimmed">
              Rules with rows waiting for a decision, the largest first, then the rules already
              applied.
            </Text>
          </Stack>
          {/*
            Re-evaluation is manual and this is the only thing that starts one
            (1.2.10). It lives on this screen because this is the screen that
            refreshes from the results, and because the app has no nav chrome to
            put it in.

            No confirmation step: a run decides nothing — every finding lands
            pending — and the operator is one of us (1.2.12). While a run is in
            flight the button is simply a disabled spinner, which is the whole
            of the progress reporting.
          */}
          <Button onClick={onApplyRules} loading={running} disabled={running}>
            Apply rules
          </Button>
        </Group>

        {state.kind === 'loading' && (
          <Group gap="sm">
            <Loader size="sm" />
            <Text>
              Calling <Code>{rulesUrl}</Code>
            </Text>
          </Group>
        )}

        {/*
          What the last press did. It is here rather than inside the panel
          because a rule-level Approve or Decline takes the rule off this list
          (1.2.1) and its panel with it — this line is what is left to show for
          it. It reports the press; the list below reports the state.
        */}
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

        {/*
          What the last run did, from the endpoint's totals. It is beside the
          decision line rather than inside it because the two answer different
          questions: this one says what the run found, that one says what a
          press decided.
        */}
        {lastRun !== null && (
          <Alert color="blue" title="Last run" withCloseButton onClose={() => setLastRun(null)}>
            <Text size="sm">{lastRun}</Text>
          </Alert>
        )}

        {runError !== null && (
          <Alert color="red" title="The run did not finish">
            <Stack gap="xs">
              <Text size="sm">{runError.message}</Text>
              {runError.status !== null && <Text size="sm">HTTP status: {runError.status}</Text>}
              <Text size="sm">
                URL tried: <Code>{runError.url}</Code>
              </Text>
              {/*
                Deliberately silent about the database. A response can be lost
                after a run that committed, so "nothing was written" would be a
                claim this screen cannot make.
              */}
              <Text size="sm">
                The screen was not refreshed, so what is below is from before the press. Press Apply
                rules again — a repeat run records nothing new.
              </Text>
            </Stack>
          </Alert>
        )}

        {state.kind === 'loaded' && state.rules.every((rule) => rule.pending === 0) && (
          <Stack gap="xs">
            <Text fw={600}>Nothing is pending.</Text>
            <Text size="sm" c="dimmed">
              A rule appears here once a run has left rows awaiting a decision. Rules whose changes
              have all been applied are listed under Applied.
            </Text>
          </Stack>
        )}

        {state.kind === 'loaded' &&
          sections(state.rules).map(
            (section) =>
              section.rules.length > 0 && (
                <Stack key={section.key} gap="xs">
                  {section.heading !== null && (
                    <Stack gap={2}>
                      <Text fw={600}>{section.heading}</Text>
                      <Text size="sm" c="dimmed">
                        {section.note}
                      </Text>
                    </Stack>
                  )}
                  {/*
            keepMounted={false} is load-bearing, not styling. Mantine keeps
            collapsed panels mounted by default, which would mount every panel
            on load and fire one GET /rules/:ruleId per listed rule. Unmounted
            collapsed panels mean the detail is read when a rule is expanded,
            and re-read when it is expanded again.
          */}
                  <Accordion variant="separated" keepMounted={false}>
                    {/*
              Keyed by rule id, which cannot repeat: exactly one version of a
              rule is active at a time (1.1.8), and the list is built from the
              active versions.
            */}
                    {section.rules.map((rule) => (
                      <Accordion.Item key={rule.ruleId} value={rule.ruleId}>
                        <Accordion.Control>
                          <Group justify="space-between" wrap="nowrap" pr="sm">
                            <Group gap="xs" wrap="nowrap">
                              <Text fw={600}>{rule.ruleName}</Text>
                              <Text size="sm" c="dimmed">
                                v{rule.version}
                              </Text>
                            </Group>
                            <Group gap="xs" wrap="nowrap">
                              {/*
                        Said on the closed line because it changes what opening
                        it costs (1.1.12): an ambiguous rule proposes nothing,
                        so its pending rows are answered one at a time rather
                        than ticked through together. Yellow is the colour the
                        panel's own notice uses for the same fact.
                      */}
                              {rule.ambiguous && (
                                <Badge variant="light" color="yellow">
                                  Needs a value
                                </Badge>
                              )}
                              {rule.pending > 0 && (
                                <Badge variant="light">{rule.pending} pending</Badge>
                              )}
                              {rule.approved > 0 && (
                                <Badge variant="light" color="green">
                                  {rule.approved} applied
                                </Badge>
                              )}
                            </Group>
                          </Group>
                        </Accordion.Control>
                        <Accordion.Panel>
                          {/*
                    The sections, the values and the row actions are the
                    panel's, read from GET /rules/:ruleId when this item is
                    expanded. This page still issues exactly one request of its
                    own, for the list.

                    A press inside the panel is reported here and re-reads the
                    list, because a decision can change which rules belong on
                    it: a rule with nothing left pending, or one whose version
                    has just been parked, leaves (1.2.1).
                  */}
                          {/*
                    Keyed by the rule id and the run counter, so a finished run
                    remounts an open panel and its rows are read again — a run
                    changes what is inside an expanded rule, and the panel reads
                    only on mount (1.2.10). The key is here rather than on the
                    accordion item so the item the user has open stays open.
                    Collapsed panels are not mounted at all.
                  */}
                          <RuleDetailPanel
                            key={`${rule.ruleId}:${runs}`}
                            ruleId={rule.ruleId}
                            onChanged={(outcome) => {
                              setLastOutcome(outcome);
                              refresh();
                            }}
                          />
                        </Accordion.Panel>
                      </Accordion.Item>
                    ))}
                  </Accordion>
                </Stack>
              ),
          )}

        {state.kind === 'failed' && (
          <Alert color="red" title="The rules could not be loaded">
            <Stack gap="xs">
              <Text size="sm">{state.error.message}</Text>
              {state.error.status !== null && (
                <Text size="sm">HTTP status: {state.error.status}</Text>
              )}
              <Text size="sm">
                URL tried: <Code>{state.error.url}</Code>
              </Text>
              <Group>
                {/*
                  Retry belongs to the failure and nowhere else. Re-reading a
                  list that loaded is what "Apply rules" above does after a run,
                  and it runs the rules first rather than only re-reading.
                */}
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
