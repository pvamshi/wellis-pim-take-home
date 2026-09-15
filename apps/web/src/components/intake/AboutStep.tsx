import { useEffect } from 'react';
import { Button, Group, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { fieldErrorsToFormErrors } from '../../intake/fieldErrors';
import type { StepFormProps } from '../../intake/StepFormProps';
import { validateDateOfBirth, validateEmail, validateFullName } from '../../intake/validation';

export interface AboutStepValues {
  full_name: string;
  email: string;
  date_of_birth: string;
}

/** Step 1 — About you (2.3.1): full name, email, date of birth. The only step with no Back — there is nowhere before it. */
export function AboutStep({ initialValues, busy, serverErrors, onNext }: StepFormProps<AboutStepValues>) {
  const form = useForm<AboutStepValues>({
    mode: 'controlled',
    initialValues,
    validateInputOnBlur: true,
    validate: (values) => ({
      full_name: validateFullName(values.full_name),
      email: validateEmail(values.email),
      date_of_birth: validateDateOfBirth(values.date_of_birth),
    }),
  });

  // The backend re-validates and is authoritative (2.5); a field it rejects
  // that this step's own check let through is shown with the backend's own
  // reason. `form` itself is a stable, ref-backed object — including it in
  // the dependency list would re-run this on every keystroke.
  useEffect(() => {
    if (serverErrors !== null) form.setErrors(fieldErrorsToFormErrors(serverErrors));
  }, [serverErrors]);

  return (
    <form onSubmit={form.onSubmit((values) => onNext({ ...values }))}>
      <Stack gap="md">
        <TextInput
          label="Full name"
          withAsterisk
          disabled={busy}
          {...form.getInputProps('full_name')}
        />
        <TextInput
          label="Email address"
          type="email"
          withAsterisk
          disabled={busy}
          {...form.getInputProps('email')}
        />
        <TextInput
          label="Date of birth"
          type="date"
          withAsterisk
          disabled={busy}
          {...form.getInputProps('date_of_birth')}
        />
        <Group justify="flex-end">
          <Button type="submit" loading={busy}>
            Next
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
