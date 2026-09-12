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
import { ApiError, getRules, rulesUrl } from '../api/client';
import type { RuleListEntry } from '../api/types';

type RequestState =
  | { kind: 'loading' }
  | { kind: 'loaded'; rules: RuleListEntry[] }
  | { kind: 'failed'; error: ApiError };

/**
 * The rules screen (1.2.1): every rule whose active version has rows waiting
 * for a decision, most first, each expandable.
 *
 * The list is rendered exactly as `GET /rules` hands it over — no sort, no
 * filter, no dropping of zero counts. That behaviour is the endpoint's (T5.1)
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

  return (
    <Container size="md" py="xl">
      <Stack gap="lg">
        <Stack gap={4}>
          <Title order={1}>Rules</Title>
          <Text size="sm" c="dimmed">
            Rules with rows waiting for a decision, the largest first.
          </Text>
        </Stack>

        {state.kind === 'loading' && (
          <Group gap="sm">
            <Loader size="sm" />
            <Text>
              Calling <Code>{rulesUrl}</Code>
            </Text>
          </Group>
        )}

        {state.kind === 'loaded' && state.rules.length === 0 && (
          <Stack gap="xs">
            <Text fw={600}>Nothing is pending.</Text>
            <Text size="sm" c="dimmed">
              A rule appears here only once a run has left rows awaiting a decision, so an empty
              screen means either no rules have been written yet or every finding has been settled.
            </Text>
          </Stack>
        )}

        {state.kind === 'loaded' && state.rules.length > 0 && (
          <Accordion variant="separated">
            {/*
              Keyed by rule id, which cannot repeat: exactly one version of a
              rule is active at a time (1.1.8), and the list is built from the
              active versions.
            */}
            {state.rules.map((rule) => (
              <Accordion.Item key={rule.ruleId} value={rule.ruleId}>
                <Accordion.Control>
                  <Group justify="space-between" wrap="nowrap" pr="sm">
                    <Group gap="xs" wrap="nowrap">
                      <Text fw={600}>{rule.ruleName}</Text>
                      <Text size="sm" c="dimmed">
                        v{rule.version}
                      </Text>
                    </Group>
                    <Badge variant="light">{rule.pending} pending</Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  {/*
                    Only what the list call already carries. The pending and
                    approved sections, the before and after values per row and
                    the row actions are T6.2's, and read GET /rules/:ruleId —
                    this page issues no second request.
                  */}
                  <Stack gap={4}>
                    <Text size="sm">
                      Rule id: <Code>{rule.ruleId}</Code>
                    </Text>
                    <Text size="sm">Active version: {rule.version}</Text>
                    <Text size="sm">Rows awaiting a decision: {rule.pending}</Text>
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
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
                  list that loaded is what "Apply rules" does after a run, and
                  that button is T6.4's.
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
