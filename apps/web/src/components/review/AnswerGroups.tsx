import { Group, Stack, Text } from '@mantine/core';
import type { RecordedAnswer, ReviewAnswers } from '../../api/types';
import { GLP1_MEDICATION_OPTIONS } from '../../intake/options';
import { STEP_TITLES } from '../../intake/steps';

const GLP1_LABELS = new Map(GLP1_MEDICATION_OPTIONS.map((option) => [option.value, option.label]));

function yesNo(value: boolean | null): string {
  return value === null ? '—' : value ? 'Yes' : 'No';
}

function optionalText(value: string | null): string {
  return value === null || value.trim() === '' ? '—' : value;
}

function medicationList(value: readonly string[] | null): string {
  if (value === null || value.length === 0) return '—';
  return value.map((entry) => GLP1_LABELS.get(entry) ?? entry).join(', ');
}

function conditionList(value: readonly string[] | null): string {
  return value === null || value.length === 0 ? '—' : value.join(', ');
}

/**
 * One answer, formatted, with legacy's "never asked" told apart from "asked
 * and left blank" (2.4: "not-recorded answers marked for legacy rows") — the
 * one distinction `answers.ts`'s plain values on their own cannot carry.
 */
function Field<T>({
  label,
  answer,
  format,
}: {
  readonly label: string;
  readonly answer: RecordedAnswer<T>;
  readonly format: (value: T) => string;
}) {
  return (
    <Group gap="xs" wrap="wrap">
      <Text size="sm" c="dimmed">
        {label}:
      </Text>
      {answer.recorded ? (
        <Text size="sm">{format(answer.value)}</Text>
      ) : (
        <Text size="sm" c="dimmed" fs="italic">
          not recorded
        </Text>
      )}
    </Group>
  );
}

/**
 * Every answer, grouped by questionnaire step (2.4) — the review detail's
 * own reading of `ReviewAnswers`, mirroring the intake form's own step
 * order and titles (`../../intake/steps.ts`) so a reviewer sees the same
 * shape the patient filled in.
 */
export function AnswerGroups({ answers }: { readonly answers: ReviewAnswers }) {
  return (
    <Stack gap="md">
      <Stack gap={6}>
        <Text fw={600}>{STEP_TITLES[1]}</Text>
        <Field label="Full name" answer={answers.step1.full_name} format={(v) => v} />
        <Field label="Email address" answer={answers.step1.email} format={(v) => v} />
        <Field label="Date of birth" answer={answers.step1.date_of_birth} format={(v) => v} />
      </Stack>

      <Stack gap={6}>
        <Text fw={600}>{STEP_TITLES[2]}</Text>
        <Field label="Height" answer={answers.step2.height_cm} format={(v) => (v === null ? '—' : `${v} cm`)} />
        <Field label="Weight" answer={answers.step2.weight_kg} format={(v) => (v === null ? '—' : `${v} kg`)} />
      </Stack>

      <Stack gap={6}>
        <Text fw={600}>{STEP_TITLES[3]}</Text>
        <Field
          label="Currently using a GLP-1 medication"
          answer={answers.step3.glp1_current}
          format={yesNo}
        />
        <Field label="Which" answer={answers.step3.glp1_medications} format={medicationList} />
        <Field
          label="Other medication"
          answer={answers.step3.other_medications}
          format={optionalText}
        />
      </Stack>

      <Stack gap={6}>
        <Text fw={600}>{STEP_TITLES[4]}</Text>
        <Field
          label="Diagnosed conditions"
          answer={answers.step4.weight_conditions}
          format={conditionList}
        />
        <Field
          label="Thyroid cancer history"
          answer={answers.step4.thyroid_cancer_history}
          format={yesNo}
        />
        <Field
          label="Pancreatitis history"
          answer={answers.step4.pancreatitis_history}
          format={yesNo}
        />
        <Field
          label="Other conditions"
          answer={answers.step4.other_conditions}
          format={optionalText}
        />
        <Field
          label="Alcohol (units/week)"
          answer={answers.step4.alcohol_units_week}
          format={(v) => (v === null ? '—' : String(v))}
        />
      </Stack>

      <Stack gap={6}>
        <Text fw={600}>{STEP_TITLES[5]}</Text>
        <Field
          label="Consent to processing health data"
          answer={answers.step5.consent_data_processing}
          format={(v) => (v ? 'Agreed' : 'Not agreed')}
        />
      </Stack>
    </Stack>
  );
}
