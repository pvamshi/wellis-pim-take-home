import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { AuditWriter } from '../audit/audit-writer.service';
import { DECISION_STATUSES, type IntakeStatus } from './intake-status';
import { Patient } from './patient.entity';

/** What one call asked for: move `id` from `from` to `to`, and who is asking. */
export interface TransitionRequest {
  readonly id: string;
  readonly from: IntakeStatus;
  readonly to: IntakeStatus;
  readonly actor: string;
  /** Required when `to` is `approved`/`rejected` (2.2's "decide, note required"); ignored otherwise. */
  readonly reason?: string | null;
}

export interface TransitionedOutcome {
  readonly outcome: 'transitioned';
  readonly patient: Patient;
}

/** The UPDATE matched no row: either `id` does not exist, or the row's current status is not `from` — a caller lost a race, or read a stale status. Either way, 2.2 says 0 rows is one outcome, and it is the controller's to turn into 409. */
export interface ConflictOutcome {
  readonly outcome: 'conflict';
}

export type TransitionOutcome = TransitionedOutcome | ConflictOutcome;

/**
 * The only write to `intake_status` (2.2, enforcement #2): a conditional
 * `UPDATE … WHERE id = :id AND intake_status = :from`, its audit event, in
 * one transaction.
 *
 * Deliberately does not re-check `(from, to)` against `INTAKE_TRANSITIONS` in
 * JS before attempting the UPDATE — that map has exactly one job already
 * (`patient-triggers.ts` compiles it into the trigger), and a second, JS-side
 * copy of the same legality check here would be the very duplication 2.2's
 * "the only definition of legal pairs" is written to prevent. An illegal pair
 * reaches the database exactly like a legal one does, and the boot-time
 * trigger is what refuses it — for a call through this method exactly as for
 * a raw `UPDATE` that bypasses it entirely, which is the "both fail" 2.2's
 * enforcement tests ask for. What this method alone adds on top of the
 * trigger is atomicity with the audit write, and the 0-rows-is-a-conflict
 * reading of a race.
 *
 * Also keeps `updated_at` current on every transition, and sets
 * `submitted_at`/`decided_at` the moment their status is reached — 2.2 lists
 * no separate write for either, and this is the one place a status change
 * happens at all, so it is where those two timestamps are kept too (spec
 * silent on this; decided here rather than leaving every future caller of
 * this method to remember it separately).
 */
@Injectable()
export class IntakeStateMachine {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditWriter: AuditWriter,
  ) {}

  /**
   * `manager`, when given, is written through instead of opening a
   * transaction of this call's own — the same passthrough
   * `RowRejectionsService.reject` already uses, so a caller can land this
   * status change in the same transaction as other writes (2.2's "evaluation,
   * same transaction" for `submitted` → `auto_*`, which also writes
   * `ruleset_version`/`evaluation`).
   */
  async transition(
    request: TransitionRequest,
    manager?: EntityManager,
  ): Promise<TransitionOutcome> {
    const run = (entityManager: EntityManager): Promise<TransitionOutcome> =>
      this.run(request, entityManager);

    return manager === undefined ? await this.dataSource.transaction(run) : await run(manager);
  }

  private async run(
    request: TransitionRequest,
    manager: EntityManager,
  ): Promise<TransitionOutcome> {
    const now = new Date().toISOString();
    const isDecision = DECISION_STATUSES.has(request.to);

    const result = await manager.update(
      Patient,
      { id: request.id, intakeStatus: request.from },
      {
        intakeStatus: request.to,
        updatedAt: now,
        ...(request.to === 'submitted' ? { submittedAt: now } : {}),
        ...(isDecision ? { decidedAt: now } : {}),
      },
    );

    if (!result.affected) {
      return { outcome: 'conflict' };
    }

    await this.auditWriter.write(manager, {
      entity: 'patient',
      entityId: request.id,
      action: isDecision ? 'decision' : 'transition',
      fromState: request.from,
      toState: request.to,
      actor: request.actor,
      reason: request.reason ?? null,
      at: now,
    });

    const patient = await manager.findOneByOrFail(Patient, { id: request.id });

    return { outcome: 'transitioned', patient };
  }
}
