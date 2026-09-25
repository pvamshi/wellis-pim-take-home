import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i39 } from '../src/rules/catalogue/i39';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I39 — a weekly alcohol unit count converted to millilitres', () => {
  let app: INestApplication;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let context: RuleContext;

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const dataSource = app.get(DataSource);
    const intakes: Repository<LegacyIntake> = dataSource.getRepository(LegacyIntake);
    context = createRuleContext(dataSource.manager);

    await intakes.save([
      { legacyIntakeId: 'in-whole', alcoholUnitsWeek: '14', rawData: '{}' },
      { legacyIntakeId: 'in-decimal', alcoholUnitsWeek: '2.5', rawData: '{}' },
      { legacyIntakeId: 'in-float-noise', alcoholUnitsWeek: '0.3', rawData: '{}' },
      { legacyIntakeId: 'in-zero', alcoholUnitsWeek: '0', rawData: '{}' },
      { legacyIntakeId: 'in-edge', alcoholUnitsWeek: '100', rawData: '{}' },
      { legacyIntakeId: 'in-padded', alcoholUnitsWeek: ' 7 ', rawData: '{}' },
      { legacyIntakeId: 'in-already-ml', alcoholUnitsWeek: '140 ml', rawData: '{}' },
      { legacyIntakeId: 'in-comma', alcoholUnitsWeek: '5,5', rawData: '{}' }, // I30's first
      { legacyIntakeId: 'in-range', alcoholUnitsWeek: '5-10', rawData: '{}' }, // I31's
      { legacyIntakeId: 'in-words', alcoholUnitsWeek: 'soms', rawData: '{}' }, // I32's
      { legacyIntakeId: 'in-negative', alcoholUnitsWeek: '-3', rawData: '{}' }, // I33's
      { legacyIntakeId: 'in-high', alcoholUnitsWeek: '150', rawData: '{}' }, // I33's
      { legacyIntakeId: 'in-null', alcoholUnitsWeek: null, rawData: '{}' }, // I34's
      { legacyIntakeId: 'in-blank', alcoholUnitsWeek: '  ', rawData: '{}' }, // I34's
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes ten millilitres a unit, written with ml after it', async () => {
    const response = await i39.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    for (const [id, prev, next] of [
      ['in-whole', '14', '140 ml'],
      ['in-decimal', '2.5', '25 ml'],
      ['in-float-noise', '0.3', '3 ml'],
      ['in-zero', '0', '0 ml'],
      ['in-edge', '100', '1000 ml'],
      ['in-padded', ' 7 ', '70 ml'],
    ] as const) {
      expect(byId.get(id)).toEqual({ table: 'intake', legacyId: id, column: 'alcohol_units_week', prev, next });
    }
    expect(response.updates).toHaveLength(6);
    expect(response.ambiguity).toBe(false);
  });

  it('leaves converted cells and other rules’ finds alone', async () => {
    const response = await i39.run(context);
    const touched = response.updates.map((update) => update.legacyId);

    for (const id of [
      'in-already-ml',
      'in-comma',
      'in-range',
      'in-words',
      'in-negative',
      'in-high',
      'in-null',
      'in-blank',
    ]) {
      expect(touched).not.toContain(id);
    }
  });

  it('is a new rule at version 1, not ambiguous, in the catalogue', () => {
    expect(i39.ruleId).toBe('I39');
    expect(i39.version).toBe(1);
    expect(i39.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i39);
  });
});
