import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AuditEvent, type AuditAction, type AuditEntity } from './audit-event.entity';

/** What one audit event records (2.8), everything but `id`, which the row generates itself. */
export interface AuditEntry {
  readonly entity: AuditEntity;
  readonly entityId: string;
  readonly action: AuditAction;
  readonly fromState?: string | null;
  readonly toState?: string | null;
  readonly actor: string;
  readonly reason?: string | null;
  /** ISO UTC. Defaults to now — a caller only passes this to share one timestamp with the row change it is recording alongside. */
  readonly at?: string;
}

/**
 * The one writer of `audit_event` (2.8: "written in the transaction of the
 * change it records"). It never opens a transaction of its own — every call
 * is handed the caller's `EntityManager`, so the audit row lands or fails with
 * whatever else that transaction is doing (`IntakeStateMachine.transition`'s
 * status UPDATE, or a future insert of the patient row itself).
 *
 * "reason required for decision" is not a `CHECK` the column table marks
 * (`AuditEvent`'s own comment), so it is enforced here, at the one place that
 * writes the table, rather than left to whichever caller remembers.
 */
@Injectable()
export class AuditWriter {
  async write(manager: EntityManager, entry: AuditEntry): Promise<AuditEvent> {
    if (entry.action === 'decision' && !hasReason(entry.reason)) {
      throw new Error('a "decision" audit event requires a reason');
    }

    const row: AuditEvent = {
      id: randomUUID(),
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      fromState: entry.fromState ?? null,
      toState: entry.toState ?? null,
      actor: entry.actor,
      reason: entry.reason ?? null,
      at: entry.at ?? new Date().toISOString(),
    };

    await manager.getRepository(AuditEvent).insert(row);

    return row;
  }
}

function hasReason(reason: string | null | undefined): boolean {
  return typeof reason === 'string' && reason.trim().length > 0;
}
