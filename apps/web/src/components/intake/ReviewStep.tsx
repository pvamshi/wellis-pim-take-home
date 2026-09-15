import type { ReactNode } from 'react';
import { Alert, Anchor, Button, Group, List, Stack, Text } from '@mantine/core';
import type { FieldError, IntakeStep, PatientAnswers } from '../../api/types';
import { GLP1_MEDICATION_OPTIONS } from '../../intake/options';
import { STEP_OF_FIELD, STEP_TITLES } from '../../intake/steps';

export interface ReviewStepProps {
  readonly answers: PatientAnswers;
  readonly busy: boolean;
  /** From the last failed `submitIntake` (2.5: submit re-validates every step at once). Null before a first attempt. */
  readonly submitErrors: readonly FieldError[] | null;
  readonly onEditStep: (step: IntakeStep) => void;
  readonly onBack: () => void;
  readonly onSubmit: () => void;
}

function yesNo(value: boolean | null): string {
  return value === null ? '—' : value ? 'Yes' : 'No';
}

function optionalText(value: string | null): string {
  return value === null || value.trim() === '' ? '—' : value;
}

const GLP1_LABELS = new Map(GLP1_MEDICATION_OPTIONS.map((option) => [option.value, option.label]));

function medicationList(value: readonly string[] | null): string {
  if (value === null || value.length === 0) return '—';
  return value.map((entry) => GLP1_LABELS.get(entry) ?? entry).join(', ');
}

function conditionList(value: readonly string[] | null): string {
  return value === null || value.length === 0 ? '—' : value.join(', ');
}

/** One answer, in the fixed "question — value" shape every step below repeats. */
function Answer({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <Group gap="xs" wrap="wrap">
      <Text size="sm" c="dimmed">
        {label}:
      </Text>
      <Text size="sm">{value}</Text>
    </Group>
  );
}

/** One step's block, with its own "Edit" link back to it (2.3: "every answer by step, edit link per step"). */
function StepBlock({
  step,
  onEditStep,
  children,
}: {
  readonly step: IntakeStep;
  readonly onEditStep: (step: IntakeStep) => void;
  readonly children: ReactNode;
}) {
  return (
    <Stack gap={6}>
      <Group justify="space-between">
        <Text fw={600}>{STEP_TITLES[step]}</Text>
        <Anchor size="sm" component="button" type="button" onClick={() => onEditStep(step)}>
          Edit
        </Anchor>
      </Group>
      {children}
    </Stack>
  );
}

/**
 * Step 6 — Check and submit (2.3.1): every answer, grouped by step, an edit
 * link per step, and Submit. The one step with no `@mantine/form` of its own
 * — nothing here is an input, only what was already saved.
 */
export function ReviewStep({
  answers,
  busy,
  submitErrors,
  onEditStep,
  onBack,
  onSubmit,
}: ReviewStepProps) {
  return (
    <Stack gap="lg">
      {submitErrors !== null && submitErrors.length > 0 && (
        <Alert color="red" title="A few answers need fixing before this can be submitted">
          <List size="sm" spacing={4}>
            {submitErrors.map((error, index) => {
              const step = error.field !== null ? STEP_OF_FIELD[error.field] : undefined;

              return (
                <List.Item key={`${error.field ?? 'form'}-${index}`}>
                  {error.reason}
                  {step !== undefined && (
                    <>
                      {' — '}
                      <Anchor size="sm" component="button" type="button" onClick={() => onEditStep(step)}>
                        fix in {STEP_TITLES[step]}
                      </Anchor>
                    </>
                  )}
                </List.Item>
              );
            })}
          </List>
        </Alert>
      )}

      <StepBlock step={1} onEditStep={onEditStep}>
        <Answer label="Full name" value={answers.full_name} />
        <Answer label="Email address" value={answers.email} />
        <Answer label="Date of birth" value={answers.date_of_birth} />
      </StepBlock>

      <StepBlock step={2} onEditStep={onEditStep}>
        <Answer label="Height" value={answers.height_cm === null ? '—' : `${answers.height_cm} cm`} />
        <Answer label="Weight" value={answers.weight_kg === null ? '—' : `${answers.weight_kg} kg`} />
      </StepBlock>

      <StepBlock step={3} onEditStep={onEditStep}>
        <Answer label="Currently using a GLP-1 medication" value={yesNo(answers.glp1_current)} />
        {answers.glp1_current === true && (
          <Answer label="Which" value={medicationList(answers.glp1_medications)} />
        )}
        <Answer label="Other medication" value={optionalText(answers.other_medications)} />
      </StepBlock>

      <StepBlock step={4} onEditStep={onEditStep}>
        <Answer label="Diagnosed conditions" value={conditionList(answers.weight_conditions)} />
        <Answer label="Thyroid cancer history" value={yesNo(answers.thyroid_cancer_history)} />
        <Answer label="Pancreatitis history" value={yesNo(answers.pancreatitis_history)} />
        <Answer label="Other conditions" value={optionalText(answers.other_conditions)} />
        <Answer
          label="Alcohol (units/week)"
          value={answers.alcohol_units_week === null ? '—' : String(answers.alcohol_units_week)}
        />
      </StepBlock>

      <StepBlock step={5} onEditStep={onEditStep}>
        <Answer
          label="Consent to processing health data"
          value={answers.consent_data_processing ? 'Agreed' : '—'}
        />
      </StepBlock>

      <Group justify="space-between">
        <Button variant="default" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button onClick={onSubmit} loading={busy}>
          Submit
        </Button>
      </Group>

      <Text size="xs" c="dimmed">
        Once submitted, these answers cannot be changed.
      </Text>
    </Stack>
  );
}
