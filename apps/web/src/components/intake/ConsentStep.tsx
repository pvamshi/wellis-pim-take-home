import { useEffect } from 'react';
import { Button, Checkbox, Group, Stack, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { CONSENT_TEXT } from '../../intake/options';
import { fieldErrorsToFormErrors } from '../../intake/fieldErrors';
import type { StepFormProps } from '../../intake/StepFormProps';
import { validateConsentChecked } from '../../intake/validation';

export interface ConsentStepValues {
  consent_data_processing: boolean;
}

/** Step 5 — Consent (2.3.1): the one checkbox that has to be ticked before Next. Saving writes a `consent_event granted` — the backend's job, not this form's. */
export function ConsentStep({
  initialValues,
  busy,
  serverErrors,
  onBack,
  onNext,
}: StepFormProps<ConsentStepValues>) {
  const form = useForm<ConsentStepValues>({
    mode: 'controlled',
    initialValues,
    validateInputOnBlur: true,
    validate: (values) => ({
      consent_data_processing: validateConsentChecked(values.consent_data_processing),
    }),
  });

  useEffect(() => {
    if (serverErrors !== null) form.setErrors(fieldErrorsToFormErrors(serverErrors));
  }, [serverErrors]);

  return (
    <form onSubmit={form.onSubmit((values) => onNext({ ...values }))}>
      <Stack gap="md">
        <Checkbox
          label={CONSENT_TEXT}
          disabled={busy}
          checked={form.values.consent_data_processing}
          onChange={(event) =>
            form.setFieldValue('consent_data_processing', event.currentTarget.checked)
          }
          error={form.errors.consent_data_processing}
        />
        <Text size="xs" c="dimmed">
          Consent text dp-2026.1.
        </Text>
        <Group justify="space-between">
          <Button variant="default" onClick={onBack} disabled={busy}>
            Back
          </Button>
          <Button type="submit" loading={busy}>
            Next
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
