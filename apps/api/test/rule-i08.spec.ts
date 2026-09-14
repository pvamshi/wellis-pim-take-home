import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i08 } from '../src/rules/catalogue/i08';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I08 — an intake submitted date that reads as a date both ways round', () => {
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
      { legacyIntakeId: 'in-slash-both', submittedAt: '03/04/2023', rawData: '{}' },
      { legacyIntakeId: 'in-dash-both', submittedAt: '03-04-2023', rawData: '{}' },
      { legacyIntakeId: 'in-slash-certain', submittedAt: '02/16/2023', rawData: '{}' },
      { legacyIntakeId: 'in-dash-certain', submittedAt: '14-08-2023', rawData: '{}' },
      { legacyIntakeId: 'in-zero', submittedAt: '00-05-2023', rawData: '{}' },
      { legacyIntakeId: 'in-iso', submittedAt: '2023-02-16', rawData: '{}' },
      { legacyIntakeId: 'in-null', submittedAt: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a two-way date with no proposed value, whichever separator it used', async () => {
    const response = await i08.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-slash-both')).toEqual({
      table: 'intake',
      legacyId: 'in-slash-both',
      column: 'submitted_at',
      prev: '03/04/2023',
      next: null,
    });
    expect(byId.get('in-dash-both')).toEqual({
      table: 'intake',
      legacyId: 'in-dash-both',
      column: 'submitted_at',
      prev: '03-04-2023',
      next: null,
    });

    // A number above 12 makes the order certain — I06's fix on the slash
    // spelling, I07's on the dash. A zero and an ISO date are neither.
    expect(byId.has('in-slash-certain')).toBe(false);
    expect(byId.has('in-dash-certain')).toBe(false);
    expect(byId.has('in-zero')).toBe(false);
    expect(byId.has('in-iso')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(i08.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i08);
  });
});
