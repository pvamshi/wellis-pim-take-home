import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import type { DuplicateDetailResponse } from '../src/duplicate-detail/duplicate-detail.controller';
import { Duplicate } from '../src/duplicates/duplicate.entity';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * A link expanded (1.7.4), over HTTP and against a real database.
 *
 * No rule run anywhere in this suite: the link and both physical rows it
 * names are seeded straight through their own repositories, the same way
 * `rule-findings.spec.ts` seeds a `writes rule rows` fixture.
 */
describe('a duplicate link expanded', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let duplicates: Repository<Duplicate>;
  let rules: Repository<Rule>;
  let patients: Repository<LegacyPatient>;
  let intakes: Repository<LegacyIntake>;
  let consents: Repository<LegacyConsent>;

  async function loadDetail(
    id: string,
  ): Promise<{ status: number; body: DuplicateDetailResponse }> {
    const response = await request(app.getHttpServer()).get(`/duplicates/${id}`);

    return { status: response.status, body: response.body as DuplicateDetailResponse };
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
    await dataSource.query(`DELETE FROM legacy_patient`);
    await dataSource.query(`DELETE FROM legacy_intake`);
    await dataSource.query(`DELETE FROM legacy_consent`);
    await dataSource.query(`DELETE FROM rule`);
  });

  it('shows both physical rows, every column, for a patient link', async () => {
    await rules.insert({
      ruleId: 'D01',
      ruleName: 'Two patients share the same normalised email',
      description: 'D01 description',
      ambiguous: false,
    });

    const duplicateRow = await patients.insert({
      legacyPatientId: 'P-450',
      fullName: 'A. Vries',
      email: 'ana@example.com',
      phone: '0612345678',
      rawData: '{"id":"P-450"}',
    });
    const canonicalRow = await patients.insert({
      legacyPatientId: 'P-100',
      fullName: 'Ana de Vries',
      email: 'ana@example.com',
      phone: null,
      rawData: '{"id":"P-100"}',
    });

    const duplicateRowId = duplicateRow.identifiers[0].id as string;
    const canonicalRowId = canonicalRow.identifiers[0].id as string;

    const link = await duplicates.insert({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-450',
      duplicateRowId,
      canonicalLegacyId: 'P-100',
      canonicalRowId,
      ruleId: 'D01',
      version: 2,
      status: 'pending',
    });
    const id = link.identifiers[0].id as string;

    const { status, body } = await loadDetail(id);

    expect(status).toBe(200);
    expect(body.table).toBe('patient');
    expect(body.status).toBe('pending');
    expect(body.ruleId).toBe('D01');
    expect(body.ruleName).toBe('Two patients share the same normalised email');
    expect(body.version).toBe(2);
    expect(body.duplicate.legacyId).toBe('P-450');
    expect(body.duplicate.values).toMatchObject({
      full_name: 'A. Vries',
      email: 'ana@example.com',
      phone: '0612345678',
    });
    expect(body.canonical.legacyId).toBe('P-100');
    expect(body.canonical.values).toMatchObject({
      full_name: 'Ana de Vries',
      email: 'ana@example.com',
      phone: null,
    });
    // Neither the surrogate id, the legacy-id column nor raw_data is a value
    // (`row-detail.service.ts`'s own `rowValues` draws the same line).
    expect(body.duplicate.values).not.toHaveProperty('id');
    expect(body.duplicate.values).not.toHaveProperty('legacy_id');
    expect(body.duplicate.values).not.toHaveProperty('raw_data');
  });

  it('shows both physical rows for an intake link, which share one legacy id', async () => {
    await rules.insert({
      ruleId: 'D05',
      ruleName: 'Two intakes share the same intake id',
      description: 'D05 description',
      ambiguous: false,
    });

    const first = await intakes.insert({
      legacyIntakeId: 'I-900',
      legacyPatientId: 'P-1',
      weight: '82kg',
      rawData: '{"id":"I-900"}',
    });
    const second = await intakes.insert({
      legacyIntakeId: 'I-900',
      legacyPatientId: 'P-1',
      weight: '83kg',
      rawData: '{"id":"I-900"}',
    });

    const link = await duplicates.insert({
      sourceTable: 'intake',
      duplicateLegacyId: 'I-900',
      duplicateRowId: second.identifiers[0].id as string,
      canonicalLegacyId: 'I-900',
      canonicalRowId: first.identifiers[0].id as string,
      ruleId: 'D05',
      version: 2,
      status: 'pending',
    });

    const { status, body } = await loadDetail(link.identifiers[0].id as string);

    expect(status).toBe(200);
    expect(body.table).toBe('intake');
    // Both sides name the same legacy id (1.7.1) — telling the two physical
    // rows apart is exactly why the link carries row ids at all.
    expect(body.duplicate.legacyId).toBe('I-900');
    expect(body.canonical.legacyId).toBe('I-900');
    expect(body.duplicate.values).toMatchObject({ weight: '83kg' });
    expect(body.canonical.values).toMatchObject({ weight: '82kg' });
  });

  it('shows both physical rows for a consent link, which also share one legacy id', async () => {
    await rules.insert({
      ruleId: 'D06',
      ruleName: 'Two consent events are identical',
      description: 'D06 description',
      ambiguous: false,
    });

    const first = await consents.insert({
      legacyPatientId: 'P-1',
      type: 'marketing',
      action: 'granted',
      at: '2021-03-04',
      version: '1',
      rawData: '{}',
    });
    const second = await consents.insert({
      legacyPatientId: 'P-1',
      type: 'marketing',
      action: 'granted',
      at: '2021-03-04',
      version: '1',
      rawData: '{}',
    });

    const link = await duplicates.insert({
      sourceTable: 'consent',
      duplicateLegacyId: 'P-1',
      duplicateRowId: second.identifiers[0].id as string,
      canonicalLegacyId: 'P-1',
      canonicalRowId: first.identifiers[0].id as string,
      ruleId: 'D06',
      version: 2,
      status: 'confirmed',
    });

    const { status, body } = await loadDetail(link.identifiers[0].id as string);

    expect(status).toBe(200);
    expect(body.table).toBe('consent');
    expect(body.status).toBe('confirmed');
    expect(body.duplicate.legacyId).toBe('P-1');
    expect(body.canonical.legacyId).toBe('P-1');
  });

  it('404s for an id no link carries', async () => {
    const { status } = await loadDetail('00000000-0000-0000-0000-000000000000');

    expect(status).toBe(404);
  });
});
