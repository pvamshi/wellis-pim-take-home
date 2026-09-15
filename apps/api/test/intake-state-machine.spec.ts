import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AuditEvent } from '../src/audit/audit-event.entity';
import {
  INTAKE_STATUSES,
  INTAKE_TRANSITIONS,
  type IntakeStatus,
} from '../src/patient/intake-status';
import { IntakeStateMachine } from '../src/patient/intake-state-machine.service';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * B1: the state machine (2.2) and the audit log (2.8) it writes to.
 *
 * Every fixture goes in through raw SQL along the legal chain from `draft`
 * (`seedPatientAt`), never through `IntakeStateMachine` — the machine is what
 * is under test, so nothing here can depend on it to set a scene up.
 */
describe('the intake state machine and audit log', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let stateMachine: IntakeStateMachine;

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    // Booting is what creates patient/audit_event and their triggers (2.2, 2.8).
    await app.init();
    dataSource = moduleRef.get(DataSource);
    stateMachine = moduleRef.get(IntakeStateMachine);
  });

  afterAll(async () => {
    await app.close();

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }

    database.cleanup();
  });

  beforeEach(async () => {
    // audit_event is append-only (2.8) — there is no clearing it between
    // tests, which is the point. Every assertion below reads back through
    // `auditEventsFor(id)`, scoped to one test's own freshly-generated id, so
    // last test's rows are simply never looked at.
    await dataSource.query(`DELETE FROM patient`);
  });

  /** The one legal path from `draft` to every other status, found by walking `INTAKE_TRANSITIONS` rather than hand-listed — stays correct if the map ever changes. */
  function pathTo(target: IntakeStatus): IntakeStatus[] {
    if (target === 'draft') return ['draft'];

    const queue: IntakeStatus[][] = [['draft']];

    while (queue.length > 0) {
      const path = queue.shift();
      if (!path) break;
      const last = path[path.length - 1];

      for (const next of INTAKE_TRANSITIONS.get(last) ?? []) {
        const extended = [...path, next];
        if (next === target) return extended;
        queue.push(extended);
      }
    }

    throw new Error(`no legal path from draft to ${target}`);
  }

  /** Inserts a fresh `patient` row and walks it, one legal `UPDATE` at a time, to `status`. */
  async function seedPatientAt(status: IntakeStatus): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();

    await dataSource.query(
      `INSERT INTO patient (id, intake_status, origin, full_name, email, date_of_birth, account_status, created_at, updated_at)
       VALUES (?, 'draft', 'intake', 'Test Patient', ?, '1990-01-01', 'prospect', ?, ?)`,
      [id, `${id}@example.com`, now, now],
    );

    const path = pathTo(status);

    for (const step of path.slice(1)) {
      await dataSource.query(`UPDATE patient SET intake_status = ? WHERE id = ?`, [step, id]);
    }

    return id;
  }

  async function statusOf(id: string): Promise<IntakeStatus> {
    const rows = await dataSource.query<{ intake_status: IntakeStatus }[]>(
      `SELECT intake_status FROM patient WHERE id = ?`,
      [id],
    );

    return rows[0].intake_status;
  }

  async function auditEventsFor(id: string): Promise<AuditEvent[]> {
    return dataSource
      .getRepository(AuditEvent)
      .find({ where: { entityId: id }, order: { at: 'ASC' } });
  }

  describe('every illegal (from, to) pair', () => {
    const illegalPairs: [IntakeStatus, IntakeStatus][] = [];

    for (const from of INTAKE_STATUSES) {
      for (const to of INTAKE_STATUSES) {
        if (!(INTAKE_TRANSITIONS.get(from)?.has(to) ?? false)) {
          illegalPairs.push([from, to]);
        }
      }
    }

    // Every state pairs illegally with 7 others (itself included), 8 states: 56 pairs.
    it('is every pair but the 9 the transitions table names legal', () => {
      expect(illegalPairs).toHaveLength(8 * 8 - 9);
    });

    for (const [from, to] of illegalPairs) {
      it(`refuses ${from} -> ${to} through the service and through raw SQL`, async () => {
        const id = await seedPatientAt(from);

        await expect(stateMachine.transition({ id, from, to, actor: 'system' })).rejects.toThrow();

        // The service's rejected attempt changed nothing (2.2 enforcement #2's
        // UPDATE, and the trigger behind it, both leave the row exactly as it was).
        expect(await statusOf(id)).toBe(from);

        // The same pair, attempted with no service in front of it at all —
        // 2.2 enforcement #4's "and through raw SQL".
        await expect(
          dataSource.query(`UPDATE patient SET intake_status = ? WHERE id = ?`, [to, id]),
        ).rejects.toThrow();

        expect(await statusOf(id)).toBe(from);
      });
    }
  });

  it('writes exactly one audit event for a legal transition', async () => {
    const id = await seedPatientAt('draft');

    const outcome = await stateMachine.transition({
      id,
      from: 'draft',
      to: 'submitted',
      actor: 'patient',
    });

    expect(outcome.outcome).toBe('transitioned');
    expect(await statusOf(id)).toBe('submitted');

    const events = await auditEventsFor(id);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entity: 'patient',
      entityId: id,
      action: 'transition',
      fromState: 'draft',
      toState: 'submitted',
      actor: 'patient',
      reason: null,
    });
  });

  it('writes the decision, not a plain transition, for in_review -> approved/rejected, and requires a reason', async () => {
    const id = await seedPatientAt('in_review');

    await expect(
      stateMachine.transition({ id, from: 'in_review', to: 'approved', actor: 'Dr. Okafor' }),
    ).rejects.toThrow(/reason/);

    expect(await statusOf(id)).toBe('in_review');

    const outcome = await stateMachine.transition({
      id,
      from: 'in_review',
      to: 'approved',
      actor: 'Dr. Okafor',
      reason: 'meets every criterion on review',
    });

    expect(outcome.outcome).toBe('transitioned');

    const events = await auditEventsFor(id);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'decision',
      fromState: 'in_review',
      toState: 'approved',
      actor: 'Dr. Okafor',
      reason: 'meets every criterion on review',
    });
  });

  it('reports a conflict, not a throw, when the row is no longer at "from" (0 rows updated)', async () => {
    const id = await seedPatientAt('draft');

    // 'submitted' -> 'auto_cleared' is a legal pair on its own; the row is
    // simply not there yet, which is the race 2.2's "0 rows -> 409" describes.
    const outcome = await stateMachine.transition({
      id,
      from: 'submitted',
      to: 'auto_cleared',
      actor: 'system',
    });

    expect(outcome).toEqual({ outcome: 'conflict' });
    expect(await statusOf(id)).toBe('draft');
    expect(await auditEventsFor(id)).toEqual([]);
  });

  it('reports a conflict for an id nothing carries', async () => {
    const outcome = await stateMachine.transition({
      id: randomUUID(),
      from: 'draft',
      to: 'submitted',
      actor: 'patient',
    });

    expect(outcome).toEqual({ outcome: 'conflict' });
  });

  describe('audit_event is append-only', () => {
    it('raises on UPDATE', async () => {
      const id = await seedPatientAt('draft');
      await stateMachine.transition({ id, from: 'draft', to: 'submitted', actor: 'patient' });
      const [event] = await auditEventsFor(id);

      await expect(
        dataSource.query(`UPDATE audit_event SET actor = 'someone else' WHERE id = ?`, [event.id]),
      ).rejects.toThrow();
    });

    it('raises on DELETE', async () => {
      const id = await seedPatientAt('draft');
      await stateMachine.transition({ id, from: 'draft', to: 'submitted', actor: 'patient' });
      const [event] = await auditEventsFor(id);

      await expect(
        dataSource.query(`DELETE FROM audit_event WHERE id = ?`, [event.id]),
      ).rejects.toThrow();

      expect(await auditEventsFor(id)).toHaveLength(1);
    });
  });

  describe("the insert rule (2.2's BEFORE INSERT)", () => {
    async function insertRaw(id: string, origin: string, status: string): Promise<unknown> {
      const now = new Date().toISOString();

      return dataSource.query(
        `INSERT INTO patient (id, intake_status, origin, full_name, email, date_of_birth, account_status, created_at, updated_at)
         VALUES (?, ?, ?, 'Test Patient', ?, '1990-01-01', 'prospect', ?, ?)`,
        [id, status, origin, `${id}@example.com`, now, now],
      );
    }

    it('raises for an intake row inserted at any status but draft', async () => {
      await expect(insertRaw(randomUUID(), 'intake', 'submitted')).rejects.toThrow();
      await expect(insertRaw(randomUUID(), 'intake', 'in_review')).rejects.toThrow();
    });

    it('raises for a legacy row inserted at any status but submitted', async () => {
      await expect(insertRaw(randomUUID(), 'legacy', 'draft')).rejects.toThrow();
      await expect(insertRaw(randomUUID(), 'legacy', 'auto_cleared')).rejects.toThrow();
    });

    it('allows exactly the two pairs 2.2 names', async () => {
      const intakeId = randomUUID();
      const legacyId = randomUUID();

      await expect(insertRaw(intakeId, 'intake', 'draft')).resolves.toBeDefined();
      await expect(insertRaw(legacyId, 'legacy', 'submitted')).resolves.toBeDefined();

      expect(await statusOf(intakeId)).toBe('draft');
      expect(await statusOf(legacyId)).toBe('submitted');
    });
  });
});
