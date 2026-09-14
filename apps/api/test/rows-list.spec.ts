import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import {
  LegacyPatientRule,
  type LegacyRuleRow,
  type LegacyRuleStatus,
} from '../src/legacy/legacy-rule.entity';
import { RowRejection } from '../src/rows/row-rejection.entity';
import type { RowsListResponse } from '../src/rows-list/rows-list.controller';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * The rows screen's list (1.6.1, 1.6.2), over HTTP and against a real
 * database.
 *
 * No rule and no rule_version anywhere in this suite: `RowListService` never
 * joins either table — a finding's `(ruleId, version)` is not part of the
 * address this screen keys on, only `(table, legacyId)` is. Every fixture is
 * seeded straight through the repositories, the same way `rules-list.spec.ts`
 * seeds what a run would have left behind.
 *
 * Nothing here asserts that a service was called. Every assertion is about the
 * body the endpoint answered with, because the list *is* the behaviour.
 *
 * Each test uses legacy ids of its own, so no test's rows can be picked up in
 * another's list.
 */

/** One rule row, as a run would have left it. Pending unless said otherwise. */
interface FindingSeed {
  legacyId: string;
  status?: LegacyRuleStatus;
}

describe('the rows list', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let patients: Repository<LegacyPatient>;
  let intakes: Repository<LegacyIntake>;
  let consents: Repository<LegacyConsent>;
  let patientRules: Repository<LegacyPatientRule>;
  let rejections: Repository<RowRejection>;

  /** A patient row, carrying only its legacy id and the rawData every legacy row needs. */
  async function seedPatient(legacyPatientId: string): Promise<void> {
    await patients.insert({ legacyPatientId, rawData: `{"id":"${legacyPatientId}"}` });
  }

  async function seedIntake(legacyIntakeId: string): Promise<void> {
    await intakes.insert({ legacyIntakeId, rawData: `{"id":"${legacyIntakeId}"}` });
  }

  async function seedConsent(legacyPatientId: string): Promise<void> {
    await consents.insert({ legacyPatientId, rawData: `{"id":"${legacyPatientId}"}` });
  }

  /** Rule rows a run would have left. Chunked, for SQLite's parameter limit. */
  async function seedFindings(
    repository: Repository<LegacyRuleRow>,
    rows: FindingSeed[],
  ): Promise<void> {
    const complete = rows.map((row, index) => ({
      ruleId: 'R-ROWS-SEED',
      version: 1,
      previousValue: null,
      nextValue: null,
      status: 'pending' as LegacyRuleStatus,
      reason: null,
      ...row,
      // Every finding needs a key of its own — (legacyId, ruleId, version,
      // column) — so two findings on the same row must differ by column.
      column: `column-${index}`,
    }));

    for (let start = 0; start < complete.length; start += 50) {
      await repository.insert(complete.slice(start, start + 50));
    }
  }

  /** The screen load itself (1.6.1). */
  async function loadRows(
    query: Record<string, string> = {},
  ): Promise<{ status: number; body: RowsListResponse }> {
    const response = await request(app.getHttpServer()).get('/rows').query(query);

    return { status: response.status, body: response.body as RowsListResponse };
  }

  /** `(table, legacyId, state)` triples, in the order the screen shows them. */
  async function listedRows(
    query: Record<string, string> = {},
  ): Promise<[string, string, string][]> {
    const { body } = await loadRows(query);

    return body.rows.map((row) => [row.table, row.legacyId, row.state]);
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    // Booting is what creates the tables: `synchronize: true` and no migration
    // step to stand in for it (tech-stack 4.4).
    await app.init();
    dataSource = moduleRef.get(DataSource);
    patients = dataSource.getRepository(LegacyPatient);
    intakes = dataSource.getRepository(LegacyIntake);
    consents = dataSource.getRepository(LegacyConsent);
    patientRules = dataSource.getRepository(LegacyPatientRule);
    rejections = dataSource.getRepository(RowRejection);
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
    await dataSource.query(`DELETE FROM legacy_patient_rule`);
    await dataSource.query(`DELETE FROM legacy_intake_rule`);
    await dataSource.query(`DELETE FROM legacy_consent_rule`);
    await dataSource.query(`DELETE FROM row_rejection`);
    await dataSource.query(`DELETE FROM legacy_patient`);
    await dataSource.query(`DELETE FROM legacy_intake`);
    await dataSource.query(`DELETE FROM legacy_consent`);
  });

  it('lists a row with a pending finding as pending', async () => {
    await seedPatient('P-0310');
    await seedFindings(patientRules, [{ legacyId: 'P-0310' }]);

    // 1.6.2, first scenario.
    expect(await listedRows({ table: 'patient' })).toEqual([['patient', 'P-0310', 'pending']]);
  });

  it('lists a row with no finding and no rejection as clean', async () => {
    await seedPatient('P-0044');

    // 1.6.2, second scenario: nothing waiting, nothing rejected.
    expect(await listedRows({ table: 'patient' })).toEqual([['patient', 'P-0044', 'clean']]);
  });

  it('lists a rejected row as rejected however its findings settle', async () => {
    await seedPatient('P-0781');
    await seedFindings(patientRules, [{ legacyId: 'P-0781', status: 'pending' }]);
    await rejections.save({ table: 'patient', legacyId: 'P-0781', reason: 'beyond repair' });

    // 1.6.2, third scenario, first half: rejected wins over a pending finding.
    expect(await listedRows({ table: 'patient' })).toEqual([['patient', 'P-0781', 'rejected']]);

    await patientRules.update(
      { legacyId: 'P-0781', ruleId: 'R-ROWS-SEED', version: 1, column: 'column-0' },
      { status: 'approved' },
    );

    // 1.6.2, third scenario, second half: "it stays rejected however its
    // findings later settle" — approving the finding changes nothing here.
    expect(await listedRows({ table: 'patient' })).toEqual([['patient', 'P-0781', 'rejected']]);
  });

  it('lists every row exactly once, whatever state it is in', async () => {
    await seedPatient('P-PENDING');
    await seedPatient('P-CLEAN');
    await seedPatient('P-REJECTED');
    await seedFindings(patientRules, [{ legacyId: 'P-PENDING' }]);
    await rejections.save({ table: 'patient', legacyId: 'P-REJECTED', reason: null });

    // 1.6.1: "every one of them is listed with its state." No row missing,
    // none doubled, whatever its state turned out to be.
    expect(await listedRows({ table: 'patient' })).toEqual([
      ['patient', 'P-CLEAN', 'clean'],
      ['patient', 'P-PENDING', 'pending'],
      ['patient', 'P-REJECTED', 'rejected'],
    ]);
  });

  it('filters the list to exactly one state', async () => {
    await seedPatient('P-A-PENDING');
    await seedPatient('P-B-CLEAN');
    await seedPatient('P-C-REJECTED');
    await seedFindings(patientRules, [{ legacyId: 'P-A-PENDING' }]);
    await rejections.save({ table: 'patient', legacyId: 'P-C-REJECTED', reason: null });

    // 1.6.1: "the list can be filtered to one state." Each filter returns
    // exactly that state's rows, no more and no fewer.
    expect(await listedRows({ table: 'patient', state: 'pending' })).toEqual([
      ['patient', 'P-A-PENDING', 'pending'],
    ]);
    expect(await listedRows({ table: 'patient', state: 'clean' })).toEqual([
      ['patient', 'P-B-CLEAN', 'clean'],
    ]);
    expect(await listedRows({ table: 'patient', state: 'rejected' })).toEqual([
      ['patient', 'P-C-REJECTED', 'rejected'],
    ]);
  });

  it('filters the list to one legacy source', async () => {
    await seedPatient('SHARED-ID');
    await seedIntake('SHARED-ID');
    await seedConsent('SHARED-ID');

    // The same legacy id in all three sources, so a table filter that leaked
    // would show it three times or under the wrong table.
    expect(await listedRows({ table: 'patient' })).toEqual([['patient', 'SHARED-ID', 'clean']]);
    expect(await listedRows({ table: 'intake' })).toEqual([['intake', 'SHARED-ID', 'clean']]);
    expect(await listedRows({ table: 'consent' })).toEqual([['consent', 'SHARED-ID', 'clean']]);
  });

  it('spans all three sources when no table filter is given', async () => {
    await seedPatient('ALL-P');
    await seedIntake('ALL-I');
    await seedConsent('ALL-C');

    // No table filter — the screen's default is every legacy row, not just
    // patients (1.6.1's own example is patients, but the task's own table
    // filter would be meaningless over a patient-only universe).
    expect(await listedRows()).toEqual([
      ['consent', 'ALL-C', 'clean'],
      ['intake', 'ALL-I', 'clean'],
      ['patient', 'ALL-P', 'clean'],
    ]);
  });

  it('pages a large result stably, with total reflecting the filtered count', async () => {
    const ids = Array.from(
      { length: 120 },
      (_, index) => `P-PAGE-${String(index).padStart(4, '0')}`,
    );

    for (let start = 0; start < ids.length; start += 50) {
      await patients.insert(
        ids.slice(start, start + 50).map((legacyPatientId) => ({
          legacyPatientId,
          rawData: `{"id":"${legacyPatientId}"}`,
        })),
      );
    }

    const first = await loadRows({ table: 'patient', page: '1' });
    const second = await loadRows({ table: 'patient', page: '2' });
    const third = await loadRows({ table: 'patient', page: '3' });

    // total is the filtered count (120), not any one page's length (50, 50, 20).
    expect(first.body.total).toBe(120);
    expect(second.body.total).toBe(120);
    expect(third.body.total).toBe(120);

    expect(first.body.rows).toHaveLength(50);
    expect(second.body.rows).toHaveLength(50);
    expect(third.body.rows).toHaveLength(20);

    // Stable and non-overlapping: concatenating every page recovers every id
    // exactly once, in the same sorted order the unpaged list would give.
    const pagedIds = [...first.body.rows, ...second.body.rows, ...third.body.rows].map(
      (row) => row.legacyId,
    );

    expect(pagedIds).toEqual([...ids].sort());
  });

  it('answers an empty page rather than an error past the last page', async () => {
    await seedPatient('P-ONLY-ONE');

    const { status, body } = await loadRows({ table: 'patient', page: '9' });

    // A page number the filter has no rows for is well-formed, not a fault —
    // the same "empty result is a state, not a failure" line the rules list
    // already draws.
    expect(status).toBe(200);
    expect(body).toEqual({ rows: [], total: 1 });
  });

  it('answers an empty list rather than an error when the dataset is empty', async () => {
    const { status, body } = await loadRows();

    expect(status).toBe(200);
    expect(body).toEqual({ rows: [], total: 0 });
  });

  it('rejects a table that is not one of the three legacy sources', async () => {
    const { status } = await loadRows({ table: 'nonsense' });

    expect(status).toBe(400);
  });

  it('rejects a state that is not one of the three row states', async () => {
    const { status } = await loadRows({ state: 'nonsense' });

    expect(status).toBe(400);
  });

  it('rejects a page that is not a positive integer', async () => {
    expect((await loadRows({ page: '0' })).status).toBe(400);
    expect((await loadRows({ page: 'one' })).status).toBe(400);
  });
});
