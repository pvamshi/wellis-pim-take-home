import { useEffect } from 'react';
import { Button, Group, NumberInput, Stack } from '@mantine/core';
import { useForm } from '@mantine/form';
import { fieldErrorsToFormErrors } from '../../intake/fieldErrors';
import type { StepFormProps } from '../../intake/StepFormProps';
import { validateHeightCm, validateWeightKg } from '../../intake/validation';

export interface BodyStepValues {
  height_cm: number | '';
  weight_kg: number | '';
}

/**
 * Step 2 — Body (2.3.1): height and weight. No BMI shown here or anywhere
 * else before submit (2.3) — this is the one step where a live number would
 * most invite exactly that.
 */
export function BodyStep({
  initialValues,
  busy,
  serverErrors,
  onBack,
  onNext,
}: StepFormProps<BodyStepValues>) {
  const form = useForm<BodyStepValues>({
    mode: 'controlled',
    initialValues,
    validateInputOnBlur: true,
    validate: (values) => ({
      height_cm: validateHeightCm(values.height_cm),
      weight_kg: validateWeightKg(values.weight_kg),
    }),
  });

  useEffect(() => {
    if (serverErrors !== null) form.setErrors(fieldErrorsToFormErrors(serverErrors));
  }, [serverErrors]);

  return (
    <form onSubmit={form.onSubmit((values) => onNext({ ...values }))}>
      <Stack gap="md">
        <NumberInput
          label="Height (cm)"
          withAsterisk
          disabled={busy}
          min={100}
          max={250}
          {...form.getInputProps('height_cm')}
        />
        <NumberInput
          label="Weight (kg)"
          withAsterisk
          disabled={busy}
          min={30}
          max={400}
          {...form.getInputProps('weight_kg')}
        />
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
