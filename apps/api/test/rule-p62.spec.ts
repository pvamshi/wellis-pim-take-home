import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { p62 } from '../src/rules/catalogue/p62';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe("P62 — a patient signup date earlier than their own dob", () => {
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
    const patients: Repository<LegacyPatient> = dataSource.getRepository(LegacyPatient);
    context = createRuleContext(dataSource.manager);

    await patients.save([
      { legacyPatientId: 'p-conflict', signupDate: '2000-01-01', dob: '2000-06-15', rawData: '{}' },
      { legacyPatientId: 'p-fine', signupDate: '2020-06-15', dob: '2000-01-01', rawData: '{}' },
      { legacyPatientId: 'p-same-day', signupDate: '2000-01-01', dob: '2000-01-01', rawData: '{}' },
      { legacyPatientId: 'p-no-dob', signupDate: '2000-01-01', dob: null, rawData: '{}' },
      { legacyPatientId: 'p-bad-signup', signupDate: 'not-a-date', dob: '2000-01-01', rawData: '{}' },

      // A two-way `signup_date`, `03/04/2010`: the 4th of March 2010 reading
      // is before `dob`, but the 3rd of April 2010 reading is not, so not
      // every reading is earlier. Checking only the first reading, or using
      // `.some()` in place of the outer `.every()`, would both say every
      // reading is earlier and wrongly report this row.
      { legacyPatientId: 'p-signup-two-way', signupDate: '03/04/2010', dob: '2010-04-01', rawData: '{}' },

      // A two-way `dob`, `04/03/2000`: `signup_date` is before the 3rd of
      // April 2000 reading but not before the 4th of March 2000 reading, so
      // not every reading of `dob` is later. Checking only the first reading,
      // or using `.some()` in place of the inner `.every()`, would both say
      // every reading is later and wrongly report this row.
      { legacyPatientId: 'p-dob-two-way', signupDate: '2000-03-05', dob: '04/03/2000', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('reports a signup date every reading of which precedes dob, proposing nothing', async () => {
    const response = await p62.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('p-conflict')).toEqual({
      table: 'patient',
      legacyId: 'p-conflict',
      column: 'signup_date',
      prev: '2000-01-01',
      next: null,
    });

    // Signup after dob, the same day, a missing dob, and an unparseable cell.
    expect(byId.has('p-fine')).toBe(false);
    expect(byId.has('p-same-day')).toBe(false);
    expect(byId.has('p-no-dob')).toBe(false);
    expect(byId.has('p-bad-signup')).toBe(false);

    // A two-way `signup_date` and a two-way `dob`, each with one reading
    // earlier and one not — the cross-product of readings the cell could be.
    expect(byId.has('p-signup-two-way')).toBe(false);
    expect(byId.has('p-dob-two-way')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(p62.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(p62);
  });
});
