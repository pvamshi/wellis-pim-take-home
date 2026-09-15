import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import type {
  DuplicateConfirmResponse,
  DuplicateDismissResponse,
} from '../src/duplicate-actions/duplicate-actions.controller';
import { Duplicate, type DuplicateSourceTable, type DuplicateStatus } from '../src/duplicates/duplicate.entity';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { Rule } from '../src/rules/rule.entity';
import { RowRejection } from '../src/rows/row-rejection.entity';
import type { RowsListResponse } from '../src/rows-list/rows-list.controller';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * Confirm and dismiss (1.7.5, 1.7.6), over HTTP and against a real database.
 *
 * No rule run anywhere in this suite: a link and the legacy rows either side
 * of it name are seeded straight through their own repositories, the same
 * fixture style `rule-findings.spec.ts` and `duplicates-list.spec.ts` already
 * use.
 */
describe('confirming and dismissing a duplicate link', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let duplicates: Repository<Duplicate>;
  let rules: Repository<Rule>;
  let patients: Repository<LegacyPatient>;
  let intakes: Repository<LegacyIntake>;
  let consents: Repository<LegacyConsent>;
  let rejections: Repository<RowRejection>;

  /** One link, seeded pending unless said otherwise, with both row ids resolved. */
  async function seedLink(options: {
    sourceTable: DuplicateSourceTable;
    duplicateLegacyId: string;
    duplicateRowId: string;
    canonicalLegacyId: string;
    canonicalRowId: string;
    ruleId: string;
    status?: DuplicateStatus;
  }): Promise<string> {
    const result = await duplicates.insert({
      sourceTable: options.sourceTable,
      duplicateLegacyId: options.duplicateLegacyId,
      duplicateRowId: options.duplicateRowId,
      canonicalLegacyId: options.canonicalLegacyId,
      canonicalRowId: options.canonicalRowId,
      ruleId: options.ruleId,
      version: 1,
      status: options.status ?? 'pending',
    });

    return result.identifiers[0].id as string;
  }

  async function confirm(
    id: string,
  ): Promise<{ status: number; body: DuplicateConfirmResponse }> {
    const response = await request(app.getHttpServer()).post(`/duplicates/${id}/confirm`);

    return { status: response.status, body: response.body as DuplicateConfirmResponse };
  }

  async function dismiss(
    id: string,
  ): Promise<{ status: number; body: DuplicateDismissResponse }> {
    const response = await request(app.getHttpServer()).post(`/duplicates/${id}/dismiss`);

    return { status: response.status, body: response.body as DuplicateDismissResponse };
  }

  /** The state `GET /rows` reports for one legacy row, or undefined if it is not in the answer. */
  async function rowState(table: string, legacyId: string): Promise<string | undefined> {
    const response = await request(app.getHttpServer()).get('/rows').query({ table, limit: 500 });
    const body = response.body as RowsListResponse;

    return body.rows.find((row) => row.legacyId === legacyId)?.state;
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    dataSource = moduleRef.get(DataSource);
    duplicates = dataSource.getRepository(Duplicate);
    rules = dataSource.getRepository(Rule);
    patients = dataSource.getRepository(LegacyPatient);
    intakes = dataSource.getRepository(LegacyIntake);
    consents = dataSource.getRepository(LegacyConsent);
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
    await dataSource.query(`DELETE FROM duplicate`);
    await dataSource.query(`DELETE FROM row_rejection`);
    await dataSource.query(`DELETE FROM legacy_patient`);
    await dataSource.query(`DELETE FROM legacy_intake`);
    await dataSource.query(`DELETE FROM legacy_consent`);
    await dataSource.query(`DELETE FROM rule`);
  });

  it('confirming a patient link rejects X, naming Y and the rule, and leaves X rejected on GET /rows', async () => {
    await rules.insert({
      ruleId: 'D01',
      ruleName: 'Two patients share the same normalised email',
      description: 'D01 description',
      ambiguous: false,
    });
    await patients.insert({ legacyPatientId: 'P-450', fullName: 'A. Vries', rawData: '{}' });
    await patients.insert({ legacyPatientId: 'P-100', fullName: 'Ana de Vries', rawData: '{}' });

    const id = await seedLink({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-450',
      duplicateRowId: 'irrelevant-for-confirm',
      canonicalLegacyId: 'P-100',
      canonicalRowId: 'irrelevant-for-confirm',
      ruleId: 'D01',
    });

    const { status, body } = await confirm(id);

    expect(status).toBe(200);
    expect(body).toEqual({ outcome: 'confirmed', id, status: 'confirmed', rejected: true });

    const stored = await duplicates.findOne({ where: { id } });
    expect(stored?.status).toBe('confirmed');

    // 1.7.5's own scenario: P-450 (X) is rejected, its reason naming P-100
    // (Y) and the rule — read directly off `row_rejection`, since no GET
    // endpoint surfaces a rejection's reason text.
    const rejection = await rejections.findOne({ where: { table: 'patient', legacyId: 'P-450' } });
    expect(rejection?.reason).toContain('P-100');
    expect(rejection?.reason).toContain('D01');

    expect(await rowState('patient', 'P-450')).toBe('rejected');
    expect(await rowState('patient', 'P-100')).not.toBe('rejected');
  });

  it('confirming an intake link rejects nothing: X and Y share a legacy id (1.7.5)', async () => {
    await rules.insert({
      ruleId: 'D05',
      ruleName: 'Two intakes share the same intake id',
      description: 'D05 description',
      ambiguous: false,
    });
    const first = await intakes.insert({ legacyIntakeId: 'I-900', rawData: '{}' });
    const second = await intakes.insert({ legacyIntakeId: 'I-900', rawData: '{}' });

    const id = await seedLink({
      sourceTable: 'intake',
      duplicateLegacyId: 'I-900',
      duplicateRowId: second.identifiers[0].id as string,
      canonicalLegacyId: 'I-900',
      canonicalRowId: first.identifiers[0].id as string,
      ruleId: 'D05',
    });

    const { status, body } = await confirm(id);

    expect(status).toBe(200);
    expect(body).toEqual({ outcome: 'confirmed', id, status: 'confirmed', rejected: false });
    expect(await rejections.count()).toBe(0);
    expect(await rowState('intake', 'I-900')).not.toBe('rejected');
  });

  it('confirming a consent link rejects nothing either', async () => {
    await rules.insert({
      ruleId: 'D06',
      ruleName: 'Two consent events are identical',
      description: 'D06 description',
      ambiguous: false,
    });
    const first = await consents.insert({ legacyPatientId: 'P-1', rawData: '{}' });
    const second = await consents.insert({ legacyPatientId: 'P-1', rawData: '{}' });

    const id = await seedLink({
      sourceTable: 'consent',
      duplicateLegacyId: 'P-1',
      duplicateRowId: second.identifiers[0].id as string,
      canonicalLegacyId: 'P-1',
      canonicalRowId: first.identifiers[0].id as string,
      ruleId: 'D06',
    });

    const { status, body } = await confirm(id);

    expect(status).toBe(200);
    expect(body).toEqual({ outcome: 'confirmed', id, status: 'confirmed', rejected: false });
    expect(await rejections.count()).toBe(0);
    expect(await rowState('consent', 'P-1')).not.toBe('rejected');
  });

  it('dismissing a pending link marks it dismissed and touches no rejection', async () => {
    await rules.insert({ ruleId: 'D01', ruleName: 'D01 name', description: 'd', ambiguous: false });
    await patients.insert({ legacyPatientId: 'P-450', rawData: '{}' });
    await patients.insert({ legacyPatientId: 'P-100', rawData: '{}' });

    const id = await seedLink({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-450',
      duplicateRowId: 'row-450',
      canonicalLegacyId: 'P-100',
      canonicalRowId: 'row-100',
      ruleId: 'D01',
    });

    const { status, body } = await dismiss(id);

    expect(status).toBe(200);
    expect(body).toEqual({ outcome: 'dismissed', id, status: 'dismissed' });

    const stored = await duplicates.findOne({ where: { id } });
    expect(stored?.status).toBe('dismissed');
    expect(await rejections.count()).toBe(0);
    expect(await rowState('patient', 'P-450')).not.toBe('rejected');
  });

  it('409s confirming a link that is already confirmed', async () => {
    await rules.insert({ ruleId: 'D01', ruleName: 'D01 name', description: 'd', ambiguous: false });
    const id = await seedLink({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-1',
      duplicateRowId: 'row-1',
      canonicalLegacyId: 'P-2',
      canonicalRowId: 'row-2',
      ruleId: 'D01',
      status: 'confirmed',
    });

    const { status } = await confirm(id);

    expect(status).toBe(409);
  });

  it('409s confirming a link that is already dismissed', async () => {
    await rules.insert({ ruleId: 'D01', ruleName: 'D01 name', description: 'd', ambiguous: false });
    const id = await seedLink({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-1',
      duplicateRowId: 'row-1',
      canonicalLegacyId: 'P-2',
      canonicalRowId: 'row-2',
      ruleId: 'D01',
      status: 'dismissed',
    });

    const { status } = await confirm(id);

    expect(status).toBe(409);
  });

  it('409s dismissing a link that is already confirmed', async () => {
    await rules.insert({ ruleId: 'D01', ruleName: 'D01 name', description: 'd', ambiguous: false });
    const id = await seedLink({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-1',
      duplicateRowId: 'row-1',
      canonicalLegacyId: 'P-2',
      canonicalRowId: 'row-2',
      ruleId: 'D01',
      status: 'confirmed',
    });

    const { status } = await dismiss(id);

    expect(status).toBe(409);
  });

  it('404s confirming or dismissing an id no link carries', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';

    expect((await confirm(missing)).status).toBe(404);
    expect((await dismiss(missing)).status).toBe(404);
  });
});
