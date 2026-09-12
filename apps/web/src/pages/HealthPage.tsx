import { useEffect, useState } from 'react';
import { Alert, Button, Code, Container, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { ApiError, apiBaseUrl, getHealth, healthUrl } from '../api/client';
import type { HealthResponse } from '../api/types';

type RequestState =
  | { kind: 'loading' }
  | { kind: 'reachable'; body: HealthResponse }
  | { kind: 'failed'; error: ApiError };

/**
 * The whole UI for now. It calls the backend's health endpoint and shows what
 * came back, so that the two halves of the repository are demonstrably talking.
 */
export function HealthPage() {
  const [state, setState] = useState<RequestState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    // Every rejection is handled here, so nothing escapes as an unhandled
    // promise rejection: a backend that is not running renders the Alert below.
    getHealth(controller.signal)
      .then((body) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'reachable', body });
      })
      .catch((cause: unknown) => {
        // An abort means this component went away; there is no one to tell.
        if (controller.signal.aborted) return;
        setState({
          kind: 'failed',
          error: cause instanceof ApiError ? cause : new ApiError(String(cause), null, healthUrl),
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

  const status =
    state.kind === 'reachable' && typeof state.body.status === 'string' && state.body.status !== ''
      ? state.body.status
      : 'reachable';

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Stack gap={4}>
          <Title order={1}>Wellis Intake</Title>
          <Text size="sm" c="dimmed">
            Backend base URL from VITE_API_BASE_URL: <Code>{apiBaseUrl}</Code>
          </Text>
        </Stack>

        {state.kind === 'loading' && (
          <Group gap="sm">
            <Loader size="sm" />
            <Text>
              Calling <Code>{healthUrl}</Code>
            </Text>
          </Group>
        )}

        {state.kind === 'reachable' && (
          <Stack gap="sm">
            <Text fw={600} c="green.8">
              {status}
            </Text>
            <Text size="sm" c="dimmed">
              Response body, as received:
            </Text>
            <Code block>{JSON.stringify(state.body, null, 2)}</Code>
          </Stack>
        )}

        {state.kind === 'failed' && (
          <Alert color="red" title="The backend did not answer">
            <Stack gap="xs">
              <Text size="sm">{state.error.message}</Text>
              {state.error.status !== null && (
                <Text size="sm">HTTP status: {state.error.status}</Text>
              )}
              <Text size="sm">
                URL tried: <Code>{state.error.url}</Code>
              </Text>
            </Stack>
          </Alert>
        )}

        <Group>
          <Button onClick={retry} disabled={state.kind === 'loading'}>
            Retry
          </Button>
        </Group>
      </Stack>
    </Container>
  );
}
