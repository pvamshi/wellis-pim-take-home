import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Code, Container, Group, Loader, Stack, Stepper, Text, Title } from '@mantine/core';
import { ApiError, createIntake, getIntake, intakeUrl, patchIntakeStep, submitIntake } from '../api/client';
import type { FieldError, IntakeStep, IntakeView, PatientAnswers } from '../api/types';
import { AboutStep, type AboutStepValues } from '../components/intake/AboutStep';
import { BodyStep, type BodyStepValues } from '../components/intake/BodyStep';
import { ConsentStep, type ConsentStepValues } from '../components/intake/ConsentStep';
import { HealthStep, type HealthStepValues } from '../components/intake/HealthStep';
import { MedicationStep, type MedicationStepValues } from '../components/intake/MedicationStep';
import { ReviewStep } from '../components/intake/ReviewStep';
import { clearStoredDraftId, getStoredDraftId, setStoredDraftId } from '../intake/draftId';
import { splitGlp1Medications } from '../intake/options';
import { STEP_TITLES } from '../intake/steps';

/** The whole questionnaire, unanswered — step 1's own form when no draft exists yet at all. */
const EMPTY_ANSWERS: PatientAnswers = {
  full_name: '',
  email: '',
  date_of_birth: '',
  height_cm: null,
  weight_kg: null,
  glp1_current: null,
  glp1_medications: null,
  other_medications: null,
  weight_conditions: null,
  thyroid_cancer_history: null,
  pancreatitis_history: null,
  other_conditions: null,
  alcohol_units_week: null,
  consent_data_processing: false,
};

/** 1–6: the five validated steps (2.3.1) plus 6, Check and submit. */
type UiStep = 1 | 2 | 3 | 4 | 5 | 6;

function parseStep(value: string | undefined): UiStep | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? (n as UiStep) : null;
}

type DraftState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly view: IntakeView }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly error: ApiError };

/**
 * B5's whole intake form (2.3): `/intake` (brand new, or resuming from
 * `localStorage`) and `/intake/:id/:step` (an id already in hand). No
 * `AppNav` anywhere on this route (2.0's route table: "no staff nav") — a
 * patient filling this in is never shown the staff console.
 *
 * One step component is mounted at a time, each owning its own
 * `@mantine/form` and its own client-side validation (2.5); this page owns
 * the network call, the move between steps, and re-showing the backend's own
 * field errors when its authoritative re-validation disagrees with the
 * step's own check.
 */
export function IntakePage() {
  const { id: routeId, step: routeStep } = useParams<{ id?: string; step?: string }>();
  const navigate = useNavigate();

  // Read once, synchronously, so a reader with a draft in progress never
  // flashes a blank step 1 before bouncing to where they left off.
  const [storedId] = useState<string | null>(() =>
    routeId === undefined ? getStoredDraftId() : null,
  );

  const [draft, setDraft] = useState<DraftState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [stepErrors, setStepErrors] = useState<readonly FieldError[] | null>(null);
  const [submitErrors, setSubmitErrors] = useState<readonly FieldError[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const id = routeId ?? null;
  const step = id === null ? 1 : parseStep(routeStep);

  useEffect(() => {
    if (id === null) {
      // Nothing exists yet — step 1 renders straight from `EMPTY_ANSWERS`, no fetch.
      setDraft({ kind: 'ready', view: { id: '', status: 'draft', answers: EMPTY_ANSWERS } });
      return;
    }

    const controller = new AbortController();
    setDraft({ kind: 'loading' });

    getIntake(id, controller.signal)
      .then((view) => {
        if (controller.signal.aborted) return;
        setDraft(view === null ? { kind: 'not-found' } : { kind: 'ready', view });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setDraft({
          kind: 'failed',
          error: cause instanceof ApiError ? cause : new ApiError(String(cause), null, intakeUrl(id)),
        });
      });

    return () => controller.abort();
  }, [id, attempt]);

  function goToStep(nextId: string, nextStep: UiStep) {
    setStepErrors(null);
    setSubmitErrors(null);
    setNotice(null);
    navigate(`/intake/${nextId}/${nextStep}`);
  }

  /** Every step 1–5's own Next: create the draft (first save) or PATCH it, then move on. */
  function saveStep(thisStep: IntakeStep, fields: Record<string, unknown>) {
    setSaving(true);
    setStepErrors(null);

    const request = id === null ? createIntake(fields) : patchIntakeStep(id, thisStep, fields);

    request
      .then((outcome) => {
        if (outcome.outcome === 'invalid') {
          setStepErrors(outcome.errors);
          return;
        }

        if (outcome.outcome === 'not-draft') {
          // Something moved this draft off `draft` from elsewhere (or it no
          // longer exists) between page load and this press — re-read it
          // rather than guess which. The next render either redirects to the
          // read-only "received" page (2.3) or shows "no longer valid" —
          // no notice needed, neither of those leaves anything to act on.
          setAttempt((n) => n + 1);
          return;
        }

        setStoredDraftId(outcome.view.id);
        // `outcome.view` is the full, current answers, not only this step's
        // own fields — set directly rather than left to a refetch, so a
        // later Back reads what was just saved instead of the id's
        // first-load snapshot (the URL's `id` does not change for steps 2-5,
        // so the `[id, attempt]` effect below has nothing to re-run for).
        setDraft({ kind: 'ready', view: outcome.view });
        goToStep(outcome.view.id, (thisStep + 1) as UiStep);
      })
      .catch((cause: unknown) => {
        setNotice(cause instanceof ApiError ? cause.message : String(cause));
      })
      .finally(() => setSaving(false));
  }

  function onSubmit() {
    if (id === null) return;

    setSaving(true);
    setSubmitErrors(null);

    submitIntake(id)
      .then((outcome) => {
        if (outcome.outcome === 'submitted') {
          clearStoredDraftId();
          navigate(`/intake/${id}/done`, { replace: true });
          return;
        }

        if (outcome.outcome === 'invalid') {
          setSubmitErrors(outcome.errors);
          return;
        }

        if (outcome.outcome === 'email-taken') {
          // 2.3: "the form returns to step 1 showing it" — the field error
          // travels as `stepErrors`, the same channel step 1 already reads.
          setStepErrors(outcome.errors);
          navigate(`/intake/${id}/1`);
          return;
        }

        // Same 'not-draft' reasoning as `saveStep` above.
        setAttempt((n) => n + 1);
      })
      .catch((cause: unknown) => {
        setNotice(cause instanceof ApiError ? cause.message : String(cause));
      })
      .finally(() => setSaving(false));
  }

  // Submitted from here or elsewhere (another tab, a resumed bookmark) —
  // 2.3's "read-only once submitted" and "the patient sees 'received', never
  // the outcome": send them to the one page that shows that, rather than
  // rendering this step's answers (still fully editable) at all.
  if (draft.kind === 'ready' && draft.view.status === 'received') {
    return <Navigate to={`/intake/${draft.view.id}/done`} replace />;
  }

  // A step outside 1–6 in the URL — typed by hand, or a stale bookmark.
  if (id !== null && step === null) {
    return <Navigate to={`/intake/${id}/1`} replace />;
  }
  if (id === null && storedId !== null) {
    return <Navigate to={`/intake/${storedId}/1`} replace />;
  }

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Stack gap={4}>
          <Title order={1}>Wellis Intake</Title>
          <Text size="sm" c="dimmed">
            A few questions to check whether we can help.
          </Text>
        </Stack>

        <Stepper active={(step ?? 1) - 1} size="sm" allowNextStepsSelect={false}>
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <Stepper.Step key={n} label={STEP_TITLES[n]} />
          ))}
          <Stepper.Step label="Check and submit" />
        </Stepper>

        {notice !== null && (
          <Alert color="blue" withCloseButton onClose={() => setNotice(null)}>
            <Text size="sm">{notice}</Text>
          </Alert>
        )}

        {draft.kind === 'loading' && (
          <Group gap="sm">
            <Loader size="sm" />
            <Text size="sm">Loading your answers…</Text>
          </Group>
        )}

        {draft.kind === 'not-found' && (
          <Alert color="red" title="This link is no longer valid">
            <Stack gap="sm">
              <Text size="sm">
                We could not find a draft at this address. It may already have been submitted, or
                the link may be wrong.
              </Text>
              <Group>
                <Button
                  variant="light"
                  onClick={() => {
                    clearStoredDraftId();
                    navigate('/intake', { replace: true });
                  }}
                >
                  Start over
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}

        {draft.kind === 'failed' && (
          <Alert color="red" title="Your answers could not be loaded">
            <Stack gap="xs">
              <Text size="sm">{draft.error.message}</Text>
              <Text size="sm">
                URL tried: <Code>{draft.error.url}</Code>
              </Text>
              <Group>
                <Button variant="light" color="red" onClick={() => setAttempt((n) => n + 1)}>
                  Retry
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}

        {draft.kind === 'ready' && step !== null && (
          <ActiveStep
            step={step}
            answers={draft.view.answers}
            saving={saving}
            stepErrors={stepErrors}
            submitErrors={submitErrors}
            onBack={(target) => {
              if (draft.view.id === '') return; // Step 1 with nothing saved yet has no Back.
              goToStep(draft.view.id, target);
            }}
            onNext={(fields) => saveStep(step as IntakeStep, fields)}
            onEditStep={(target) => goToStep(draft.view.id, target)}
            onSubmit={onSubmit}
          />
        )}
      </Stack>
    </Container>
  );
}

interface ActiveStepProps {
  readonly step: UiStep;
  readonly answers: PatientAnswers;
  readonly saving: boolean;
  readonly stepErrors: readonly FieldError[] | null;
  readonly submitErrors: readonly FieldError[] | null;
  readonly onBack: (target: UiStep) => void;
  readonly onNext: (fields: Record<string, unknown>) => void;
  readonly onEditStep: (target: IntakeStep) => void;
  readonly onSubmit: () => void;
}

/** Picks the one step component this render mounts, and feeds it this draft's own answers (2.3.1). */
function ActiveStep({
  step,
  answers,
  saving,
  stepErrors,
  submitErrors,
  onBack,
  onNext,
  onEditStep,
  onSubmit,
}: ActiveStepProps) {
  switch (step) {
    case 1: {
      const values: AboutStepValues = {
        full_name: answers.full_name,
        email: answers.email,
        date_of_birth: answers.date_of_birth,
      };
      return (
        <AboutStep initialValues={values} busy={saving} serverErrors={stepErrors} onNext={onNext} />
      );
    }
    case 2: {
      const values: BodyStepValues = {
        height_cm: answers.height_cm ?? '',
        weight_kg: answers.weight_kg ?? '',
      };
      return (
        <BodyStep
          initialValues={values}
          busy={saving}
          serverErrors={stepErrors}
          onBack={() => onBack(1)}
          onNext={onNext}
        />
      );
    }
    case 3: {
      const split = splitGlp1Medications(answers.glp1_medications);
      const values: MedicationStepValues = {
        glp1_current: answers.glp1_current,
        glp1_selected: split.selected,
        glp1_other_text: split.otherText,
        other_medications: answers.other_medications ?? '',
      };
      return (
        <MedicationStep
          initialValues={values}
          busy={saving}
          serverErrors={stepErrors}
          onBack={() => onBack(2)}
          onNext={onNext}
        />
      );
    }
    case 4: {
      const values: HealthStepValues = {
        weight_conditions: [...(answers.weight_conditions ?? [])],
        thyroid_cancer_history: answers.thyroid_cancer_history,
        pancreatitis_history: answers.pancreatitis_history,
        other_conditions: answers.other_conditions ?? '',
        alcohol_units_week: answers.alcohol_units_week ?? '',
      };
      return (
        <HealthStep
          initialValues={values}
          busy={saving}
          serverErrors={stepErrors}
          onBack={() => onBack(3)}
          onNext={onNext}
        />
      );
    }
    case 5: {
      const values: ConsentStepValues = { consent_data_processing: answers.consent_data_processing };
      return (
        <ConsentStep
          initialValues={values}
          busy={saving}
          serverErrors={stepErrors}
          onBack={() => onBack(4)}
          onNext={onNext}
        />
      );
    }
    case 6:
      return (
        <ReviewStep
          answers={answers}
          busy={saving}
          submitErrors={submitErrors}
          onEditStep={onEditStep}
          onBack={() => onBack(5)}
          onSubmit={onSubmit}
        />
      );
  }
}
