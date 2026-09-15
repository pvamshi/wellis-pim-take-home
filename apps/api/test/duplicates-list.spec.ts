import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { Duplicate, type DuplicateSourceTable, type DuplicateStatus } from '../src/duplicates/duplicate.entity';
import type { DuplicatesListResponse } from '../src/duplicates-list/duplicates-list.controller';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * The duplicates screen's list (1.7.4), over HTTP and against a real database.
 *
 * No rule run anywhere in this suite: loading the screen runs no rule, so
 * every link is seeded straight through the `duplicate` repository, the same
 * way `rules-list.spec.ts` seeds rule rows straight through its own
 * repositories.
 */
describe('the duplicates list', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let duplicates: Repository<Duplicate>;
  let rules: Repository<Rule>;

  /** One link, as a run would have left it. Pending unless said otherwise. */
  async function seedLink(overrides: {
    sourceTable: DuplicateSourceTable;
    duplicateLegacyId: string;
    canonicalLegacyId: string;
    ruleId: string;
    status?: DuplicateStatus;
  }): Promise<void> {
    await duplicates.insert({
      sourceTable: overrides.sourceTable,
      duplicateLegacyId: overrides.duplicateLegacyId,
      duplicateRowId: `row-${overrides.duplicateLegacyId}`,
      canonicalLegacyId: overrides.canonicalLegacyId,
      canonicalRowId: `row-${overrides.canonicalLegacyId}`,
      ruleId: overrides.ruleId,
      version: 1,
      status: overrides.status ?? 'pending',
    });
  }

  /** A rule, minimal — only the name matters to this screen (1.7.4). */
  async function seedRule(ruleId: string, ruleName: string): Promise<void> {
    await rules.insert({ ruleId, ruleName, description: `${ruleId} description`, ambiguous: false });
  }

  /** The screen load itself. */
  async function loadDuplicates(
    query = '',
  ): Promise<{ status: number; body: DuplicatesListResponse }> {
    const response = await request(app.getHttpServer()).get(`/duplicates${query}`);

    return { status: response.status, body: response.body as DuplicatesListResponse };
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
    await dataSource.query(`DELETE FROM rule`);
  });

  it('answers an empty list rather than an error when nothing has ever been found', async () => {
    const { status, body } = await loadDuplicates();

    expect(status).toBe(200);
    expect(body).toEqual({ links: [], total: 0 });
  });

  it('shows a link with the rule that found it joined in', async () => {
    await seedRule('D01', 'Two patients share the same normalised email');
    await seedLink({ sourceTable: 'patient', duplicateLegacyId: 'P-450', canonicalLegacyId: 'P-100', ruleId: 'D01' });

    const { status, body } = await loadDuplicates();

    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.links).toEqual([
      expect.objectContaining({
        table: 'patient',
        duplicateLegacyId: 'P-450',
        canonicalLegacyId: 'P-100',
        ruleId: 'D01',
        ruleName: 'Two patients share the same normalised email',
        status: 'pending',
      }),
    ]);
  });

  it('filters by table', async () => {
    await seedRule('D01', 'D01 name');
    await seedRule('D05', 'D05 name');
    await seedLink({ sourceTable: 'patient', duplicateLegacyId: 'P-450', canonicalLegacyId: 'P-100', ruleId: 'D01' });
    await seedLink({ sourceTable: 'intake', duplicateLegacyId: 'I-900', canonicalLegacyId: 'I-900', ruleId: 'D05' });

    const { body } = await loadDuplicates('?table=intake');

    expect(body.total).toBe(1);
    expect(body.links).toEqual([expect.objectContaining({ table: 'intake', duplicateLegacyId: 'I-900' })]);
  });

  it('filters by status', async () => {
    await seedRule('D01', 'D01 name');
    await seedLink({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-1',
      canonicalLegacyId: 'P-2',
      ruleId: 'D01',
      status: 'pending',
    });
    await seedLink({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-3',
      canonicalLegacyId: 'P-4',
      ruleId: 'D01',
      status: 'confirmed',
    });
    await seedLink({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-5',
      canonicalLegacyId: 'P-6',
      ruleId: 'D01',
      status: 'dismissed',
    });

    const { body } = await loadDuplicates('?status=confirmed');

    expect(body.total).toBe(1);
    expect(body.links).toEqual([expect.objectContaining({ duplicateLegacyId: 'P-3', status: 'confirmed' })]);
  });

  it('filters by table and status together', async () => {
    await seedRule('D01', 'D01 name');
    await seedRule('D05', 'D05 name');
    await seedLink({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-1',
      canonicalLegacyId: 'P-2',
      ruleId: 'D01',
      status: 'pending',
    });
    await seedLink({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-3',
      canonicalLegacyId: 'P-4',
      ruleId: 'D01',
      status: 'confirmed',
    });
    await seedLink({
      sourceTable: 'intake',
      duplicateLegacyId: 'I-1',
      canonicalLegacyId: 'I-1',
      ruleId: 'D05',
      status: 'confirmed',
    });

    const { body } = await loadDuplicates('?table=patient&status=confirmed');

    expect(body.total).toBe(1);
    expect(body.links).toEqual([expect.objectContaining({ table: 'patient', duplicateLegacyId: 'P-3' })]);
  });

  it('answers unfiltered — not pending-only — when the caller names no status (1.7.4 is the screen’s own default)', async () => {
    await seedRule('D01', 'D01 name');
    await seedLink({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-1',
      canonicalLegacyId: 'P-2',
      ruleId: 'D01',
      status: 'confirmed',
    });
    await seedLink({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-3',
      canonicalLegacyId: 'P-4',
      ruleId: 'D01',
      status: 'dismissed',
    });

    const { body } = await loadDuplicates();

    expect(body.total).toBe(2);
  });

  it('sorts by (table, duplicateLegacyId, canonicalLegacyId) for a stable, repeatable order', async () => {
    await seedRule('D01', 'D01 name');
    await seedRule('D05', 'D05 name');
    await seedLink({ sourceTable: 'intake', duplicateLegacyId: 'I-2', canonicalLegacyId: 'I-2', ruleId: 'D05' });
    await seedLink({ sourceTable: 'patient', duplicateLegacyId: 'P-9', canonicalLegacyId: 'P-1', ruleId: 'D01' });
    await seedLink({ sourceTable: 'patient', duplicateLegacyId: 'P-2', canonicalLegacyId: 'P-1', ruleId: 'D01' });

    const { body } = await loadDuplicates();

    expect(body.links.map((link) => [link.table, link.duplicateLegacyId])).toEqual([
      ['intake', 'I-2'],
      ['patient', 'P-2'],
      ['patient', 'P-9'],
    ]);
  });

  it('paginates with offset and limit, and total counts the whole filtered set', async () => {
    await seedRule('D01', 'D01 name');

    for (let index = 1; index <= 5; index += 1) {
      await seedLink({
        sourceTable: 'patient',
        duplicateLegacyId: `P-${index}`,
        canonicalLegacyId: 'P-0',
        ruleId: 'D01',
      });
    }

    const first = await loadDuplicates('?limit=2');
    const second = await loadDuplicates('?limit=2&offset=2');

    expect(first.body.total).toBe(5);
    expect(first.body.links).toHaveLength(2);
    expect(second.body.total).toBe(5);
    expect(second.body.links).toHaveLength(2);
    expect(first.body.links.map((link) => link.duplicateLegacyId)).not.toEqual(
      second.body.links.map((link) => link.duplicateLegacyId),
    );
  });

  it('rejects an unrecognised table or status with a 400', async () => {
    const badTable = await loadDuplicates('?table=nowhere');
    const badStatus = await loadDuplicates('?status=nowhere');

    expect(badTable.status).toBe(400);
    expect(badStatus.status).toBe(400);
  });
});
