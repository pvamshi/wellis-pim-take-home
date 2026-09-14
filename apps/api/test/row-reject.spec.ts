import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import type { RowRejectionResponse } from '../src/row-actions/row-actions.controller';
import { RowRejection } from '../src/rows/row-rejection.entity';
import { RowRejectionsService } from '../src/rows/row-rejections.service';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * Rejecting and un-rejecting a row (1.6.6), over HTTP and against a real
 * database.
 *
 * No legacy data and no rule tables anywhere in this suite: 1.6.6 is explicit
 * that rejecting "writes nothing to the data", and neither press reads any
 * table but `row_rejection` — `row-rejection-entity.spec.ts` already proves
 * that table's own shape, so this suite is only the write path onto it.
 *
 * Every assertion reads `row_rejection` back once the response came in,
 * because "presence of the row is the fact" (`row-rejection.entity.ts`) —
 * there is no status column whose value a test could otherwise be checking.
 */
describe('rejecting and un-rejecting a row', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let rejections: Repository<RowRejection>;
  let rejectionsService: RowRejectionsService;

  /** The rejection row for one address, or null when there is none. */
  async function rejectionOf(legacyId: string): Promise<RowRejection | null> {
    return await rejections.findOne({ where: { table: 'patient', legacyId } });
  }

  /** The press behind Reject (1.6.6). */
  async function reject(
    legacyId: string,
    body?: unknown,
  ): Promise<{ status: number; body: RowRejectionResponse }> {
    const req = request(app.getHttpServer()).post(`/rows/patient/${legacyId}/reject`);
    const response = body === undefined ? await req : await req.send(body as object);

    return { status: response.status, body: response.body as RowRejectionResponse };
  }

  /** The press behind Un-reject (1.6.6). */
  async function unreject(legacyId: string): Promise<{ status: number; body: RowRejectionResponse }> {
    const response = await request(app.getHttpServer()).post(`/rows/patient/${legacyId}/unreject`);

    return { status: response.status, body: response.body as RowRejectionResponse };
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    // A malformed table segment is still a 400, and Nest logs the stack of
    // any non-HTTP exception it turns into a 500. Silenced so a passing run's
    // output holds no stack trace that looks like a failure.
    app = moduleRef.createNestApplication({ logger: false });
    // Booting is what creates the tables: `synchronize: true` and no
    // migration step to stand in for it (tech-stack 4.4).
    await app.init();
    dataSource = moduleRef.get(DataSource);
    rejections = dataSource.getRepository(RowRejection);
    rejectionsService = moduleRef.get(RowRejectionsService);
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
    await dataSource.query(`DELETE FROM row_rejection`);
  });

  it('rejects a row with a reason, and un-rejects it, round-tripping back to not rejected', async () => {
    const rejected = await reject('P-0781', { reason: 'beyond repair' });

    // 200 rather than the 201 a POST defaults to: nothing was created at a URL.
    expect(rejected.status).toBe(200);
    expect(rejected.body).toEqual({
      table: 'patient',
      legacyId: 'P-0781',
      rejected: true,
      reason: 'beyond repair',
    });
    expect(await rejectionOf('P-0781')).toMatchObject({
      table: 'patient',
      legacyId: 'P-0781',
      reason: 'beyond repair',
    });

    const unrejected = await unreject('P-0781');

    // 1.6.6: reversible, unlike an accepted change — taking it back costs
    // nothing and loses nothing, which is exactly the row_rejection row
    // ceasing to exist.
    expect(unrejected.status).toBe(200);
    expect(unrejected.body).toEqual({
      table: 'patient',
      legacyId: 'P-0781',
      rejected: false,
      reason: null,
    });
    expect(await rejectionOf('P-0781')).toBeNull();
  });

  it('rejects a row with no reason at all (1.6.6 shows a reason, never requires one)', async () => {
    const { status, body } = await reject('P-0044');

    expect(status).toBe(200);
    expect(body).toEqual({ table: 'patient', legacyId: 'P-0044', rejected: true, reason: null });
    expect(await rejectionOf('P-0044')).toMatchObject({ reason: null });
  });

  it('rejecting twice updates the one row rather than failing on the second press', async () => {
    await reject('P-0781', { reason: 'first look' });
    const second = await reject('P-0781', { reason: 'second look, still beyond repair' });

    expect(second.body).toEqual({
      table: 'patient',
      legacyId: 'P-0781',
      rejected: true,
      reason: 'second look, still beyond repair',
    });
    // One row, not two: the key is (table, legacyId), so a second press finds
    // the first row rather than colliding with it.
    expect(await rejections.count()).toBe(1);
    expect(await rejectionOf('P-0781')).toMatchObject({ reason: 'second look, still beyond repair' });
  });

  it('un-rejecting a row that was never rejected deletes nothing and reports it as not rejected', async () => {
    const { status, body } = await unreject('P-NEVER-REJECTED');

    expect(status).toBe(200);
    expect(body).toEqual({
      table: 'patient',
      legacyId: 'P-NEVER-REJECTED',
      rejected: false,
      reason: null,
    });
    expect(await rejectionOf('P-NEVER-REJECTED')).toBeNull();
  });

  it('keeps rejections apart by table for the same legacy id', async () => {
    await reject('SHARED-ID', { reason: 'patient row is bad' });

    const intakeReject = await request(app.getHttpServer())
      .post('/rows/intake/SHARED-ID/reject')
      .send({});

    expect(intakeReject.status).toBe(200);
    expect(await rejections.count()).toBe(2);

    // Un-rejecting one source leaves the other's rejection standing — the key
    // is (table, legacyId), and a legacy id names a row without identifying
    // one (1.0.3) even across sources.
    await unreject('SHARED-ID');

    expect(await rejectionOf('SHARED-ID')).toBeNull();
    expect(
      await rejections.findOne({ where: { table: 'intake', legacyId: 'SHARED-ID' } }),
    ).toMatchObject({ reason: null });
  });

  it('rejects an unrecognised table with a 400, and a reason that is present but not a string', async () => {
    const badTable = await request(app.getHttpServer()).post('/rows/nowhere/P-1/reject').send({});
    const badReason = await request(app.getHttpServer())
      .post('/rows/patient/P-1/reject')
      .send({ reason: 42 });

    expect(badTable.status).toBe(400);
    expect(badReason.status).toBe(400);
    expect(await rejectionOf('P-1')).toBeNull();
  });

  it('guards the table in the service itself against a caller that is not this codebase', async () => {
    // `RowRejectionsService` is typed to `LegacySourceTable`, unlike the
    // row-wide approve/decline pair — it writes straight into a column with
    // no whitelist `Map` to miss against, so TypeScript itself is what stops
    // a garbage value here rather than a runtime guard.
    await rejectionsService.reject('patient', 'P-TYPED', 'ok');

    expect(await rejectionOf('P-TYPED')).toMatchObject({ reason: 'ok' });
  });
});
