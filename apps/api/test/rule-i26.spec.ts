import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i26 } from '../src/rules/catalogue/i26';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I26 — an intake current-medication value that is un-normalised free text', () => {
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
      { legacyIntakeId: 'in-real', medsCurrent: 'Metformin 500mg', rawData: '{}' },
      { legacyIntakeId: 'in-multi', medsCurrent: 'lisinopril, atorvastatine', rawData: '{}' },
      { legacyIntakeId: 'in-padded', medsCurrent: '  Metformin  ', rawData: '{}' }, // I24's finding
      { legacyIntakeId: 'in-marker', medsCurrent: 'geen', rawData: '{}' }, // I25's finding
      { legacyIntakeId: 'in-blank', medsCurrent: '   ', rawData: '{}' },
      { legacyIntakeId: 'in-null', medsCurrent: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports un-normalised medication free text, proposing nothing', async () => {
    const response = await i26.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-real')).toEqual({
      table: 'intake',
      legacyId: 'in-real',
      column: 'meds_current',
      prev: 'Metformin 500mg',
      next: null,
    });
    expect(byId.get('in-multi')).toEqual({
      table: 'intake',
      legacyId: 'in-multi',
      column: 'meds_current',
      prev: 'lisinopril, atorvastatine',
      next: null,
    });

    const touched = response.updates.map((update) => update.legacyId);
    expect(touched).not.toContain('in-padded');
    expect(touched).not.toContain('in-marker');
    expect(touched).not.toContain('in-blank');
    expect(touched).not.toContain('in-null');

    expect(response.ambiguity).toBe(true);
    expect(i26.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i26);
  });
});
