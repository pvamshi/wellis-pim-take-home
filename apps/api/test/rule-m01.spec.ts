import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { Duplicate } from '../src/duplicates/duplicate.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { m01 } from '../src/rules/catalogue/m01';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext, RuleResponse } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('M01 — fills an empty full_name from a confirmed duplicate', () => {
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
      { legacyPatientId: 'y-empty', fullName: null, rawData: '{}' },
      { legacyPatientId: 'x-value', fullName: 'Alice Doe', rawData: '{}' },
      { legacyPatientId: 'y-filled', fullName: 'Existing Name', rawData: '{}' },
      { legacyPatientId: 'x-other', fullName: 'Someone Else', rawData: '{}' },
      { legacyPatientId: 'y-pending', fullName: null, rawData: '{}' },
      { legacyPatientId: 'x-pending', fullName: 'Pending Name', rawData: '{}' },
      { legacyPatientId: 'y-dismissed', fullName: null, rawData: '{}' },
      { legacyPatientId: 'x-dismissed', fullName: 'Dismissed Name', rawData: '{}' },
      { legacyPatientId: 'y-conflict', fullName: null, rawData: '{}' },
      { legacyPatientId: 'x-conflict-1', fullName: 'Value One', rawData: '{}' },
      { legacyPatientId: 'x-conflict-2', fullName: 'Value Two', rawData: '{}' },
      { legacyPatientId: 'y-agree', fullName: null, rawData: '{}' },
      { legacyPatientId: 'x-agree-1', fullName: 'Same Value', rawData: '{}' },
      { legacyPatientId: 'x-agree-2', fullName: 'Same Value', rawData: '{}' },
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
      link('x-agree-1', 'y-agree', 'confirmed'),
      link('x-agree-2', 'y-agree', 'confirmed'),
    ]);

    response = await m01.run(context);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('fills an empty full_name with the value of one confirmed duplicate', () => {
    expect(response.updates).toContainEqual({
      table: 'patient',
      legacyId: 'y-empty',
      column: 'full_name',
      prev: null,
      next: 'Alice Doe',
    });
    expect(response.ambiguity).toBe(false);
    expect(m01.ambiguous).toBe(false);
    expect(m01.version).toBe(1);
    expect(ruleCatalogue).toContain(m01);
  });

  it('leaves a full_name that is already filled alone, even with a confirmed duplicate', () => {
    expect(response.updates.some((update) => update.legacyId === 'y-filled')).toBe(false);
  });

  it('ignores a pending or a dismissed link', () => {
    expect(response.updates.some((update) => update.legacyId === 'y-pending')).toBe(false);
    expect(response.updates.some((update) => update.legacyId === 'y-dismissed')).toBe(false);
  });

  it('proposes nothing when two confirmed duplicates hold different values', () => {
    expect(response.updates.some((update) => update.legacyId === 'y-conflict')).toBe(false);
  });

  it('proposes the shared value when two confirmed duplicates agree', () => {
    expect(response.updates).toContainEqual({
      table: 'patient',
      legacyId: 'y-agree',
      column: 'full_name',
      prev: null,
      next: 'Same Value',
    });
  });
});
