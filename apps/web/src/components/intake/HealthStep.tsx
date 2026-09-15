import { useEffect } from 'react';
import { Button, Checkbox, Group, NumberInput, Radio, Stack, Textarea } from '@mantine/core';
import { useForm } from '@mantine/form';
import { fieldErrorsToFormErrors } from '../../intake/fieldErrors';
import { NONE_OF_THESE, WEIGHT_CONDITION_OPTIONS } from '../../intake/options';
import type { StepFormProps } from '../../intake/StepFormProps';
import {
  validateAlcoholUnitsWeek,
  validateWeightConditions,
  validateYesNo,
} from '../../intake/validation';

export interface HealthStepValues {
  weight_conditions: string[];
  thyroid_cancer_history: boolean | null;
  pancreatitis_history: boolean | null;
  other_conditions: string;
  alcohol_units_week: number | '';
}

/**
 * Step 4 — Health (2.3.1): diagnosed conditions, thyroid cancer and
 * pancreatitis history, anything else, and weekly alcohol.
 *
 * "None of these" is exclusive on screen, not only on the server (2.5): the
 * two directions of the tick clear whichever else is selected, rather than
 * letting an impossible combination reach Next only to bounce off the
 * backend.
 */
export function HealthStep({
  initialValues,
  busy,
  serverErrors,
  onBack,
  onNext,
}: StepFormProps<HealthStepValues>) {
  const form = useForm<HealthStepValues>({
    mode: 'controlled',
    initialValues,
    validateInputOnBlur: true,
    validate: (values) => ({
      weight_conditions: validateWeightConditions(values.weight_conditions),
      thyroid_cancer_history: validateYesNo(values.thyroid_cancer_history),
      pancreatitis_history: validateYesNo(values.pancreatitis_history),
      alcohol_units_week: validateAlcoholUnitsWeek(values.alcohol_units_week),
    }),
  });

  useEffect(() => {
    if (serverErrors !== null) form.setErrors(fieldErrorsToFormErrors(serverErrors));
  }, [serverErrors]);

  function onWeightConditionsChange(value: string[]) {
    const hadNoneAlready = form.values.weight_conditions.includes(NONE_OF_THESE);
    const justAddedNone = value.includes(NONE_OF_THESE) && !hadNoneAlready;

    // Ticking "none of these" clears every other tick; ticking anything else
    // while it was already the sole answer drops it instead — whichever
    // direction the exclusivity was just crossed in wins.
    form.setFieldValue(
      'weight_conditions',
      justAddedNone
        ? [NONE_OF_THESE]
        : value.filter((entry) => entry !== NONE_OF_THESE),
    );
  }

  function submit(values: HealthStepValues) {
    onNext({
      weight_conditions: values.weight_conditions,
      thyroid_cancer_history: values.thyroid_cancer_history,
      pancreatitis_history: values.pancreatitis_history,
      other_conditions: values.other_conditions.trim() === '' ? null : values.other_conditions,
      alcohol_units_week: values.alcohol_units_week === '' ? null : values.alcohol_units_week,
    });
  }

  return (
    <form onSubmit={form.onSubmit(submit)}>
      <Stack gap="md">
        <Checkbox.Group
          label="Have you been diagnosed with any of these?"
          withAsterisk
          value={form.values.weight_conditions}
          onChange={onWeightConditionsChange}
          error={form.errors.weight_conditions}
        >
          <Stack mt="xs" gap="xs">
            {WEIGHT_CONDITION_OPTIONS.map((condition) => (
              <Checkbox key={condition} value={condition} label={condition} disabled={busy} />
            ))}
          </Stack>
        </Checkbox.Group>

        <Radio.Group
          label="Have you ever been diagnosed with thyroid cancer?"
          withAsterisk
          value={
            form.values.thyroid_cancer_history === null
              ? null
              : form.values.thyroid_cancer_history
                ? 'yes'
                : 'no'
          }
          onChange={(value) => form.setFieldValue('thyroid_cancer_history', value === 'yes')}
          error={form.errors.thyroid_cancer_history}
        >
          <Group mt="xs">
            <Radio value="yes" label="Yes" disabled={busy} />
            <Radio value="no" label="No" disabled={busy} />
          </Group>
        </Radio.Group>

        <Radio.Group
          label="Have you ever had pancreatitis?"
          withAsterisk
          value={
            form.values.pancreatitis_history === null
              ? null
              : form.values.pancreatitis_history
                ? 'yes'
                : 'no'
          }
          onChange={(value) => form.setFieldValue('pancreatitis_history', value === 'yes')}
          error={form.errors.pancreatitis_history}
        >
          <Group mt="xs">
            <Radio value="yes" label="Yes" disabled={busy} />
            <Radio value="no" label="No" disabled={busy} />
          </Group>
        </Radio.Group>

        <Textarea
          label="Any other conditions we should know about?"
          description="Optional"
          autosize
          minRows={2}
          disabled={busy}
          {...form.getInputProps('other_conditions')}
        />

        <NumberInput
          label="How many units of alcohol do you drink in a typical week?"
          description="Optional"
          disabled={busy}
          min={0}
          max={200}
          allowDecimal={false}
          {...form.getInputProps('alcohol_units_week')}
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
