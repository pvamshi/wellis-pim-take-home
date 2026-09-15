import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Patient } from '../patient/patient.entity';
import type { PatientOrigin } from '../patient/intake-status';

/** The only consent type asked for so far (2.1.2). A union of one, not a bare string, so a second type is a compile error everywhere this is matched on. */
export type ConsentEventType = 'data_processing';

export type ConsentEventAction = 'granted' | 'revoked';

/**
 * Append-only history of one patient's consent (2.1.2): "a patient has many
 * consent events." Every row is a fact about a moment, never edited — there
 * is no update path here, the same way `AuditEvent` has none, though nothing
 * enforces that by trigger the way `audit_event` does, since 2.1.2 never
 * asks for one.
 *
 * `type`, `action` and `origin` are not marked "not null" in 2.1.2's column
 * table the way `patient.origin`/`account_status` are — but a consent event
 * that happened without a known type, action or origin describes nothing, so
 * all three are `NOT NULL` here (spec silent; decided in this schema's own
 * style, which pairs every other `CHECK`-constrained enum column with an
 * explicit null/not-null rather than leaving it to SQLite's "NULL passes any
 * CHECK" default).
 */
@Check(`type IN ('data_processing')`)
@Check(`action IN ('granted', 'revoked')`)
@Check(`origin IN ('intake', 'legacy')`)
@Entity('consent_event')
export class ConsentEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK `patient.id` (2.1.2) — a real relation, unlike the legacy tables' ids: `patient.id` is a generated, genuinely unique key. */
  @Index()
  @Column({ name: 'patient_id', type: 'text' })
  patientId!: string;

  @ManyToOne(() => Patient)
  @JoinColumn({ name: 'patient_id' })
  patient!: Patient;

  @Column({ name: 'type', type: 'text' })
  type!: ConsentEventType;

  @Column({ name: 'action', type: 'text' })
  action!: ConsentEventAction;

  /** The consent text's version, e.g. `dp-2026.1` (2.3.1). */
  @Column({ name: 'version', type: 'text' })
  version!: string;

  /** ISO UTC. */
  @Column({ name: 'at', type: 'text' })
  at!: string;

  @Column({ name: 'origin', type: 'text' })
  origin!: PatientOrigin;

  /** The legacy consent data row this event was copied from on import (2.6); null for one an intake wrote itself. */
  @Column({ name: 'legacy_row_id', type: 'text', nullable: true })
  legacyRowId!: string | null;
}
