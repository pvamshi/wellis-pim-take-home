import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** The two tables an audit event can be about (2.8). Consent's own history is `consent_event` itself; this is the log of state changes and decisions made about a row of either. */
export type AuditEntity = 'patient' | 'consent_event';

/**
 * `create`/`import` are the two ways a `patient` row starts existing (2.2's
 * insert rules); `transition` is every other `intake_status` UPDATE;
 * `decision` is specifically `in_review` → `approved`/`rejected`, the one
 * transition 2.2 requires a note for. `IntakeStateMachine.transition` picks
 * `transition` or `decision` for itself — see `DECISION_STATUSES` — because
 * both are UPDATEs; `create`/`import` are written by whichever caller inserts
 * the row, since `AuditWriter` has no INSERT of its own to watch.
 */
export type AuditAction = 'create' | 'import' | 'transition' | 'decision';

/**
 * The audit log (2.8): every `patient`/`consent_event` state change and every
 * human decision, written in the same transaction as the change it records.
 *
 * Append-only by trigger (`audit-triggers.ts`), not by convention — the two
 * `CHECK`s here are what the column table marks (`entity`, `action`); "reason
 * required for decision" is not marked `CHECK` there, so it is `AuditWriter`'s
 * invariant to keep, not the schema's (2.5's line between what a validator
 * rejects and what the schema itself enforces applies here too).
 */
@Check(`entity IN ('patient', 'consent_event')`)
@Check(`action IN ('create', 'import', 'transition', 'decision')`)
@Entity('audit_event')
export class AuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'entity', type: 'text' })
  entity!: AuditEntity;

  /** Names a row of `entity`'s table without a foreign key — `AuditEvent` outlives whatever a future change does to that row. */
  @Index()
  @Column({ name: 'entity_id', type: 'text' })
  entityId!: string;

  @Column({ name: 'action', type: 'text' })
  action!: AuditAction;

  @Column({ name: 'from_state', type: 'text', nullable: true })
  fromState!: string | null;

  @Column({ name: 'to_state', type: 'text', nullable: true })
  toState!: string | null;

  /** `system`, `patient`, or a staff name (2.8) — free text, not a `CHECK`: a staff name is not a closed set. */
  @Column({ name: 'actor', type: 'text' })
  actor!: string;

  /** Null except for `decision`, where `AuditWriter.write` requires it (2.8). */
  @Column({ name: 'reason', type: 'text', nullable: true })
  reason!: string | null;

  /** ISO UTC. */
  @Column({ name: 'at', type: 'text' })
  at!: string;
}
