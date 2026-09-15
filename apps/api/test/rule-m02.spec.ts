import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { Duplicate } from '../src/duplicates/duplicate.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { m02 } from '../src/rules/catalogue/m02';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleResponse } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('M02 — fills an empty email from a confirmed duplicate', () => {
  let app: INestApplication;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let context: RuleContext;
  let response: RuleResponse;

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const dataSource = app.get(DataSource);
    const patients: Repository<LegacyPatient> = dataSource.getRepository(LegacyPatient);
    const duplicates: Repository<Duplicate> = dataSource.getRepository(Duplicate);
    context = createRuleContext(dataSource.manager);

    const saved = await patients.save([
      { legacyPatientId: 'y-empty', email: null, rawData: '{}' },
      { legacyPatientId: 'x-value', email: 'alice@example.com', rawData: '{}' },
      { legacyPatientId: 'y-filled', email: 'existing@example.com', rawData: '{}' },
      { legacyPatientId: 'x-other', email: 'other@example.com', rawData: '{}' },
      { legacyPatientId: 'y-pending', email: null, rawData: '{}' },
      { legacyPatientId: 'x-pending', email: 'pending@example.com', rawData: '{}' },
      { legacyPatientId: 'y-dismissed', email: null, rawData: '{}' },
      { legacyPatientId: 'x-dismissed', email: 'dismissed@example.com', rawData: '{}' },
      { legacyPatientId: 'y-conflict', email: null, rawData: '{}' },
      { legacyPatientId: 'x-conflict-1', email: 'one@example.com', rawData: '{}' },
      { legacyPatientId: 'x-conflict-2', email: 'two@example.com', rawData: '{}' },
    ]);

    const byLegacyId = new Map(saved.map((patient) => [patient.legacyPatientId, patient]));
    const rowId = (legacyId: string): string => {
      const patient = byLegacyId.get(legacyId);
      if (patient === undefined) throw new Error(`seed missing: ${legacyId}`);
      return patient.id;
    };

    const link = (
      duplicateLegacyId: string,
      canonicalLegacyId: string,
      status: 'pending' | 'confirmed' | 'dismissed',
    ) => ({
      sourceTable: 'patient' as const,
      duplicateLegacyId,
      duplicateRowId: rowId(duplicateLegacyId),
      canonicalLegacyId,
      canonicalRowId: rowId(canonicalLegacyId),
      ruleId: 'D01',
      version: 2,
      status,
    });

    await duplicates.save([
      link('x-value', 'y-empty', 'confirmed'),
      link('x-other', 'y-filled', 'confirmed'),
      link('x-pending', 'y-pending', 'pending'),
      link('x-dismissed', 'y-dismissed', 'dismissed'),
      link('x-conflict-1', 'y-conflict', 'confirmed'),
      link('x-conflict-2', 'y-conflict', 'confirmed'),
    ]);

    response = await m02.run(context);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('fills an empty email with the value of one confirmed duplicate', () => {
    expect(response.updates).toContainEqual({
      table: 'patient',
      legacyId: 'y-empty',
      column: 'email',
      prev: null,
      next: 'alice@example.com',
    });
    expect(response.ambiguity).toBe(false);
    expect(m02.ambiguous).toBe(false);
    expect(m02.version).toBe(1);
    expect(ruleCatalogue).toContain(m02);
  });

  it('leaves an email that is already filled alone, even with a confirmed duplicate', () => {
    expect(response.updates.some((update) => update.legacyId === 'y-filled')).toBe(false);
  });

  it('ignores a pending or a dismissed link', () => {
    expect(response.updates.some((update) => update.legacyId === 'y-pending')).toBe(false);
    expect(response.updates.some((update) => update.legacyId === 'y-dismissed')).toBe(false);
  });

  it('proposes nothing when two confirmed duplicates hold different values', () => {
    expect(response.updates.some((update) => update.legacyId === 'y-conflict')).toBe(false);
  });
});
