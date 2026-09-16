import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditEvent } from '../audit/audit-event.entity';
import type { ConsentEvent } from '../consent/consent-event.entity';
import { ConsentEventsService } from '../consent/consent-events.service';
import { computeAgeYears } from '../eligibility/age';
import { IntakeStateMachine } from '../patient/intake-state-machine.service';
import { INTAKE_STATUSES, type IntakeStatus, type PatientOrigin } from '../patient/intake-status';
import { Patient, type EvaluationEntry } from '../patient/patient.entity';
import { answersOf, type PatientAnswers } from '../patient/patient-answers';
import { fieldError, type FieldError } from '../patient/validation/field-error';

/**
 * Every status the queue may be filtered to (2.4) — the whole of 2.2, not a
 * subset of it, so a row is never off every screen. A decided patient, and an
 * unfinished draft, stay findable on a list rather than only by pasting a
 * uuid into the detail route. Taken from `INTAKE_STATUSES` rather than
 * restated, so a ninth status could not be born unreachable.
 */
export const QUEUE_STATUSES: readonly IntakeStatus[] = INTAKE_STATUSES;

/** The queue's own default (2.4): the work waiting, and nothing else. Every other status is selectable, not shown unasked. */
export const DEFAULT_QUEUE_STATUSES: readonly IntakeStatus[] = [
  'auto_flagged',
  'auto_cleared',
  'in_review',
];

const AUTO_STATUSES: ReadonlySet<IntakeStatus> = new Set([
  'auto_cleared',
  'auto_flagged',
  'auto_rejected',
]);

export interface QueueFilter {
  readonly statuses?: readonly IntakeStatus[];
  readonly origin?: PatientOrigin;
}

/** One line of the queue (2.4): name, submitted, origin, age, BMI, status, matched flags. */
export interface ReviewQueueEntry {
  readonly id: string;
  /** Who the line is about. The uuid names the row to the machine; this names it to the reviewer. */
  readonly name: string;
  readonly submittedAt: string | null;
  readonly origin: PatientOrigin;
  readonly age: number;
  readonly bmi: number | null;
  readonly status: IntakeStatus;
  /** Every rule id that matched (2.7) — flag and reject alike, the "matched flags" column. */
  readonly matchedRuleIds: string[];
}

/** One answer, with whether it was ever asked (2.4: "not-recorded answers marked for legacy rows"). */
export interface RecordedAnswer<T> {
  readonly value: T;
  readonly recorded: boolean;
}

export interface ReviewAnswers {
  readonly step1: {
    readonly full_name: RecordedAnswer<string>;
    readonly email: RecordedAnswer<string>;
    readonly date_of_birth: RecordedAnswer<string>;
  };
  readonly step2: {
    readonly height_cm: RecordedAnswer<number | null>;
    readonly weight_kg: RecordedAnswer<number | null>;
  };
  readonly step3: {
    readonly glp1_current: RecordedAnswer<boolean | null>;
    readonly glp1_medications: RecordedAnswer<readonly string[] | null>;
    readonly other_medications: RecordedAnswer<string | null>;
  };
  readonly step4: {
    readonly weight_conditions: RecordedAnswer<readonly string[] | null>;
    readonly thyroid_cancer_history: RecordedAnswer<boolean | null>;
    readonly pancreatitis_history: RecordedAnswer<boolean | null>;
    readonly other_conditions: RecordedAnswer<string | null>;
    readonly alcohol_units_week: RecordedAnswer<number | null>;
  };
  readonly step5: {
    readonly consent_data_processing: RecordedAnswer<boolean>;
  };
}

export interface ReviewDetail {
  readonly id: string;
  readonly origin: PatientOrigin;
  readonly status: IntakeStatus;
  readonly submittedAt: string | null;
  readonly decidedAt: string | null;
  readonly age: number;
  readonly answers: ReviewAnswers;
  readonly evaluation: {
    readonly rulesetVersion: string | null;
    readonly results: EvaluationEntry[];
  };
  /** Status history (2.4), oldest first. */
  readonly history: AuditEvent[];
}

export type ReviewStartOutcome =
  | { readonly outcome: 'started'; readonly patient: Patient }
  /** No row at this id, or its status is not one of the three `auto_*` (2.9: "409" is the only error named). */
  | { readonly outcome: 'conflict' };

export interface DecideRequest {
  readonly decision: 'approved' | 'rejected';
  readonly note: string;
  readonly actor: string;
}

export type ReviewDecideOutcome =
  | { readonly outcome: 'decided'; readonly patient: Patient }
  | { readonly outcome: 'conflict' }
  | { readonly outcome: 'invalid'; readonly errors: FieldError[] };

/**
 * The review queue and detail (2.4, 2.9): one screen over both origins, and
 * the two presses that move a row through it. Read-only aside from `start`
 * and `decide`, both of which are `IntakeStateMachine.transition` underneath
 * — this service decides *which* `from` to attempt and reports the outcome as
 * a value (services throw no HTTP exceptions), never re-implements the
 * legality check the state machine and its trigger already own.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stateMachine: IntakeStateMachine,
    private readonly consentEvents: ConsentEventsService,
  ) {}

  /** The queue (2.4): default filter, or the caller's own subset of any status, oldest first. */
  async queue(filter: QueueFilter): Promise<ReviewQueueEntry[]> {
    const statuses = filter.statuses ?? DEFAULT_QUEUE_STATUSES;

    const query = this.dataSource
      .getRepository(Patient)
      .createQueryBuilder('patient')
      .where('patient.intake_status IN (:...statuses)', { statuses })
      // "Oldest first" reads on `submitted_at`, which a draft has not got. It
      // falls back to `created_at` rather than sorting as null, so a draft
      // takes its own place in the one line by when it started, instead of
      // bunching every draft at whichever end the dialect puts nulls. `id`
      // then breaks exact ties: without it rows sharing a timestamp come back
      // in whatever order SQLite likes, which need not be the same order
      // twice, and the same two loads would disagree.
      .orderBy('COALESCE(patient.submitted_at, patient.created_at)', 'ASC')
      .addOrderBy('patient.id', 'ASC');

    if (filter.origin !== undefined) {
      query.andWhere('patient.origin = :origin', { origin: filter.origin });
    }

    const patients = await query.getMany();

    return patients.map((patient) => ({
      id: patient.id,
      name: patient.fullName,
      submittedAt: patient.submittedAt,
      origin: patient.origin,
      age: ageAt(patient),
      bmi: patient.bmi,
      status: patient.intakeStatus,
      matchedRuleIds: (patient.evaluation ?? [])
        .filter((entry) => entry.matched)
        .map((entry) => entry.ruleId),
    }));
  }

  /** One row's answers, evaluation and status history (2.4). Null for an id naming no patient. */
  async detail(id: string): Promise<ReviewDetail | null> {
    const patient = await this.dataSource.getRepository(Patient).findOneBy({ id });

    if (patient === null) {
      return null;
    }

    const events = await this.consentEvents.listFor(id);
    const history = await this.dataSource
      .getRepository(AuditEvent)
      .find({ where: { entityId: id }, order: { at: 'ASC' } });

    return {
      id: patient.id,
      origin: patient.origin,
      status: patient.intakeStatus,
      submittedAt: patient.submittedAt,
      decidedAt: patient.decidedAt,
      age: ageAt(patient),
      answers: buildAnswers(patient, events, this.consentEvents),
      evaluation: { rulesetVersion: patient.rulesetVersion, results: patient.evaluation ?? [] },
      history,
    };
  }

  /** Start review (2.4): `auto_*` → `in_review`, actor recorded. */
  async start(id: string, actor: string): Promise<ReviewStartOutcome> {
    const patient = await this.dataSource.getRepository(Patient).findOneBy({ id });

    if (patient === null || !AUTO_STATUSES.has(patient.intakeStatus)) {
      return { outcome: 'conflict' };
    }

    const result = await this.stateMachine.transition({
      id,
      from: patient.intakeStatus,
      to: 'in_review',
      actor,
    });

    return result.outcome === 'conflict'
      ? { outcome: 'conflict' }
      : { outcome: 'started', patient: result.patient };
  }

  /** Approve or reject (2.4): `in_review` → `approved`/`rejected`, a trimmed non-empty note required. */
  async decide(id: string, request: DecideRequest): Promise<ReviewDecideOutcome> {
    const note = request.note.trim();

    if (note.length === 0) {
      return { outcome: 'invalid', errors: [fieldError('note', request.note, 'note is required')] };
    }

    const patient = await this.dataSource.getRepository(Patient).findOneBy({ id });

    if (patient === null || patient.intakeStatus !== 'in_review') {
      return { outcome: 'conflict' };
    }

    const result = await this.stateMachine.transition({
      id,
      from: 'in_review',
      to: request.decision,
      actor: request.actor,
      reason: note,
    });

    return result.outcome === 'conflict'
      ? { outcome: 'conflict' }
      : { outcome: 'decided', patient: result.patient };
  }
}

/** Age at submission (2.7's own convention), or today's for a draft, which has not been submitted yet and whose age is therefore still moving. */
function ageAt(patient: Patient): number {
  const asOf = patient.submittedAt !== null ? new Date(patient.submittedAt) : new Date();

  return computeAgeYears(patient.dateOfBirth, asOf);
}

function recorded<T>(legacy: boolean, value: T): RecordedAnswer<T> {
  return { value, recorded: !legacy || value !== null };
}

function buildAnswers(
  patient: Patient,
  events: readonly ConsentEvent[],
  consentEvents: ConsentEventsService,
): ReviewAnswers {
  const legacy = patient.origin === 'legacy';
  const answers: PatientAnswers = answersOf(
    patient,
    consentEvents.hasGrantedDataProcessing(events),
  );

  return {
    step1: {
      full_name: { value: answers.full_name, recorded: true },
      email: { value: answers.email, recorded: true },
      date_of_birth: { value: answers.date_of_birth, recorded: true },
    },
    step2: {
      height_cm: recorded(legacy, answers.height_cm),
      weight_kg: recorded(legacy, answers.weight_kg),
    },
    step3: {
      glp1_current: recorded(legacy, answers.glp1_current),
      glp1_medications: recorded(legacy, answers.glp1_medications),
      other_medications: recorded(legacy, answers.other_medications),
    },
    step4: {
      weight_conditions: recorded(legacy, answers.weight_conditions),
      thyroid_cancer_history: recorded(legacy, answers.thyroid_cancer_history),
      pancreatitis_history: recorded(legacy, answers.pancreatitis_history),
      other_conditions: recorded(legacy, answers.other_conditions),
      alcohol_units_week: recorded(legacy, answers.alcohol_units_week),
    },
    step5: {
      // Unlike every other field, "recorded" for consent means an event
      // exists at all — a granted/revoked value with no event is not "null",
      // so the generic null check `recorded()` uses does not apply here.
      consent_data_processing: {
        value: answers.consent_data_processing,
        recorded: legacy ? consentEvents.hasDataProcessingRecord(events) : true,
      },
    },
  };
}
