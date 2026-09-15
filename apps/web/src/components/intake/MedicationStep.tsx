import { useEffect } from 'react';
import { Button, Checkbox, Group, Radio, Stack, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { fieldErrorsToFormErrors } from '../../intake/fieldErrors';
import { combineGlp1Medications, GLP1_MEDICATION_OPTIONS, GLP1_OTHER_VALUE } from '../../intake/options';
import type { StepFormProps } from '../../intake/StepFormProps';
import { validateGlp1Medications, validateYesNo } from '../../intake/validation';

export interface MedicationStepValues {
  glp1_current: boolean | null;
  /** The five known codes, plus `GLP1_OTHER_VALUE` when "Other" is ticked — one `Checkbox.Group` array (2.3.1's "other + text" is this array plus `glp1_other_text` below). */
  glp1_selected: string[];
  glp1_other_text: string;
  other_medications: string;
}

/**
 * Step 3 — Medication (2.3.1): whether the patient currently uses a GLP-1
 * medication, which one(s), and anything else they take.
 *
 * `combineGlp1Medications` folds the checkbox array and the "Other" text box
 * into the one flat list 2.3.1 stores — see `../../intake/options.ts` for
 * why the wire shape has no column of its own for the typed-in name.
 */
export function MedicationStep({
  initialValues,
  busy,
  serverErrors,
  onBack,
  onNext,
}: StepFormProps<MedicationStepValues>) {
  const form = useForm<MedicationStepValues>({
    mode: 'controlled',
    initialValues,
    validateInputOnBlur: true,
    validate: (values) => {
      const medications = combineGlp1Medications(values.glp1_selected, values.glp1_other_text);

      return {
        glp1_current: validateYesNo(values.glp1_current),
        glp1_selected: validateGlp1Medications(medications, values.glp1_current),
      };
    },
  });

  useEffect(() => {
    if (serverErrors === null) return;

    // The backend names this field `glp1_medications` (2.5) — the flat list
    // this step folds two on-screen fields into (`combineGlp1Medications`).
    // Its own error has to land on the checkbox group it actually came from,
    // not silently on a form key nothing renders.
    const mapped = fieldErrorsToFormErrors(serverErrors);
    if ('glp1_medications' in mapped) {
      mapped.glp1_selected = mapped.glp1_medications;
      delete mapped.glp1_medications;
    }
    form.setErrors(mapped);
  }, [serverErrors]);

  const current = form.values.glp1_current;
  const otherChecked = form.values.glp1_selected.includes(GLP1_OTHER_VALUE);

  function onCurrentChange(value: string) {
    const yes = value === 'yes';
    form.setFieldValue('glp1_current', yes);

    // 2.5: "empty when no" — cleared rather than merely hidden, so a
    // selection made before switching the answer to "no" is not silently
    // resubmitted underneath it.
    if (!yes) {
      form.setFieldValue('glp1_selected', []);
      form.setFieldValue('glp1_other_text', '');
    }
  }

  function submit(values: MedicationStepValues) {
    onNext({
      glp1_current: values.glp1_current,
      glp1_medications: combineGlp1Medications(values.glp1_selected, values.glp1_other_text),
      other_medications: values.other_medications.trim() === '' ? null : values.other_medications,
    });
  }

  return (
    <form onSubmit={form.onSubmit(submit)}>
      <Stack gap="md">
        <Radio.Group
          label="Are you currently using a GLP-1 medication, such as Ozempic, Wegovy or Mounjaro?"
          withAsterisk
          value={current === null ? null : current ? 'yes' : 'no'}
          onChange={onCurrentChange}
          error={form.errors.glp1_current}
        >
          <Group mt="xs">
            <Radio value="yes" label="Yes" disabled={busy} />
            <Radio value="no" label="No" disabled={busy} />
          </Group>
        </Radio.Group>

        {current === true && (
          <Checkbox.Group
            label="Which?"
            withAsterisk
            value={form.values.glp1_selected}
            onChange={(value) => form.setFieldValue('glp1_selected', value)}
            error={form.errors.glp1_selected}
          >
            <Stack mt="xs" gap="xs">
              {GLP1_MEDICATION_OPTIONS.map((option) => (
                <Checkbox
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  disabled={busy}
                />
              ))}
              <Checkbox value={GLP1_OTHER_VALUE} label="Other" disabled={busy} />
              {otherChecked && (
                <TextInput
                  ml="xl"
                  placeholder="Which medication?"
                  aria-label="Other GLP-1 medication"
                  disabled={busy}
                  value={form.values.glp1_other_text}
                  onChange={(event) =>
                    form.setFieldValue('glp1_other_text', event.currentTarget.value)
                  }
                />
              )}
            </Stack>
          </Checkbox.Group>
        )}

        <Textarea
          label="Any other medication you currently use?"
          description="Optional"
          autosize
          minRows={2}
          disabled={busy}
          {...form.getInputProps('other_medications')}
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
