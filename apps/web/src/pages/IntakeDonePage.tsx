import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Container, Loader, Stack, Text, Title } from '@mantine/core';
import { getIntake } from '../api/client';
import { clearStoredDraftId } from '../intake/draftId';

type State = 'checking' | 'received' | 'not-found' | 'failed';

/**
 * `/intake/:id/done` (2.3, 2.0): the neutral "received" page. Never a BMI,
 * never the outcome — every `intake_status` from `submitted` on reads the
 * same here, whether the row went on to `auto_cleared` or `auto_rejected`.
 * No `AppNav` (2.0): this is the patient's own screen.
 */
export function IntakeDonePage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    clearStoredDraftId();

    if (id === undefined) {
      setState('not-found');
      return;
    }

    const controller = new AbortController();

    getIntake(id, controller.signal)
      .then((view) => {
        if (controller.signal.aborted) return;
        setState(view === null || view.status !== 'received' ? 'not-found' : 'received');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Nothing this page can retry into: whether it is unreachable or the
        // id is simply wrong, there is nothing more specific to tell a
        // patient than "we cannot confirm this".
        setState('failed');
      });

    return () => controller.abort();
  }, [id]);

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg" align="center" ta="center">
        {state === 'checking' && <Loader />}

        {state === 'received' && (
          <>
            <Title order={1}>Thank you</Title>
            <Text>
              We&rsquo;ve received your answers. We&rsquo;ll be in touch once they&rsquo;ve been
              reviewed.
            </Text>
          </>
        )}

        {(state === 'not-found' || state === 'failed') && (
          <Alert color="red" title="We could not confirm this" w="100%">
            <Text size="sm">
              This link does not point to a submitted intake. If you just submitted one, please
              check the email address you used.
            </Text>
          </Alert>
        )}
      </Stack>
    </Container>
  );
}
