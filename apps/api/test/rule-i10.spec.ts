import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { i10 } from '../src/rules/catalogue/i10';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe("I10 — an intake submitted date earlier than the patient's signup date", () => {
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
    const intakes: Repository<LegacyIntake> = dataSource.getRepository(LegacyIntake);
    context = createRuleContext(dataSource.manager);

    await patients.save([
      { legacyPatientId: 'rec-real', signupDate: '2020-06-15', rawData: '{}' },
      { legacyPatientId: 'rec-fine', signupDate: '2000-01-01', rawData: '{}' },
      { legacyPatientId: 'rec-same-day', signupDate: '2000-01-01', rawData: '{}' },
      { legacyPatientId: 'rec-no-signup', signupDate: null, rawData: '{}' },
      { legacyPatientId: 'rec-signup-fixed', signupDate: '2010-03-10', rawData: '{}' },
      { legacyPatientId: 'rec-signup-two-way', signupDate: '04/03/2000', rawData: '{}' },
      // Same legacy id twice (1.0.3): one signup after the submission, one
      // before, so the finding cannot hold against every matching patient.
      { legacyPatientId: 'rec-dup', signupDate: '2025-01-01', rawData: '{}' },
      { legacyPatientId: 'rec-dup', signupDate: '2000-01-01', rawData: '{}' },
    ]);

    await intakes.save([
      { legacyIntakeId: 'in-conflict', legacyPatientId: 'rec-real', submittedAt: '2000-01-01', rawData: '{}' },
      { legacyIntakeId: 'in-fine', legacyPatientId: 'rec-fine', submittedAt: '2020-06-15', rawData: '{}' },
      { legacyIntakeId: 'in-same-day', legacyPatientId: 'rec-same-day', submittedAt: '2000-01-01', rawData: '{}' },
      { legacyIntakeId: 'in-no-signup', legacyPatientId: 'rec-no-signup', submittedAt: '2000-01-01', rawData: '{}' },
      { legacyIntakeId: 'in-bad-submitted', legacyPatientId: 'rec-real', submittedAt: 'not-a-date', rawData: '{}' },
      { legacyIntakeId: 'in-null-submitted', legacyPatientId: 'rec-real', submittedAt: null, rawData: '{}' },
      { legacyIntakeId: 'in-missing-patient', legacyPatientId: 'rec-missing', submittedAt: '2000-01-01', rawData: '{}' },
      // Padded but would match once trimmed — I03's fix, not this rule's.
      { legacyIntakeId: 'in-padded', legacyPatientId: ' rec-real', submittedAt: '2000-01-01', rawData: '{}' },
      // No reference to check at all — I05's finding.
      { legacyIntakeId: 'in-blank', legacyPatientId: '   ', submittedAt: '2000-01-01', rawData: '{}' },
      { legacyIntakeId: 'in-null-patient', legacyPatientId: null, submittedAt: '2000-01-01', rawData: '{}' },

      // A two-way `submitted_at`, `03/04/2010`: the 4th of March 2010
      // reading is before the patient's signup date, but the 3rd of April
      // 2010 reading is not, so not every reading is earlier. Checking only
      // the first reading, or `.some()` in place of the outer `.every()`,
      // would both wrongly report this row.
      { legacyIntakeId: 'in-submitted-two-way', legacyPatientId: 'rec-signup-fixed', submittedAt: '03/04/2010', rawData: '{}' },

      // A two-way patient `signup_date`, `04/03/2000`: submitted is before
      // the 3rd of April 2000 reading but not before the 4th of March 2000
      // reading, so not every reading of the signup date is later. Checking
      // only the first reading, or `.some()` in place of the inner
      // `.every()`, would both wrongly report this row.
      { legacyIntakeId: 'in-signup-two-way', legacyPatientId: 'rec-signup-two-way', submittedAt: '2000-03-05', rawData: '{}' },

      { legacyIntakeId: 'in-dup', legacyPatientId: 'rec-dup', submittedAt: '2010-01-01', rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it("reports a submitted date every reading of which precedes the matched patient's signup date, proposing nothing", async () => {
    const response = await i10.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-conflict')).toEqual({
      table: 'intake',
      legacyId: 'in-conflict',
      column: 'submitted_at',
      prev: '2000-01-01',
      next: null,
    });

    // Submitted after signup, the same day, no signup to compare against, an
    // unparseable or missing submission date, and a reference that is
    // missing, padded or blank.
    expect(byId.has('in-fine')).toBe(false);
    expect(byId.has('in-same-day')).toBe(false);
    expect(byId.has('in-no-signup')).toBe(false);
    expect(byId.has('in-bad-submitted')).toBe(false);
    expect(byId.has('in-null-submitted')).toBe(false);
    expect(byId.has('in-missing-patient')).toBe(false);
    expect(byId.has('in-padded')).toBe(false);
    expect(byId.has('in-blank')).toBe(false);
    expect(byId.has('in-null-patient')).toBe(false);

    // A two-way `submitted_at` and a two-way patient `signup_date`, each with
    // one reading earlier and one not — the cross-product of readings either
    // cell could be.
    expect(byId.has('in-submitted-two-way')).toBe(false);
    expect(byId.has('in-signup-two-way')).toBe(false);

    // Two patient rows share the same legacy id; one has a later signup date
    // and one an earlier one, so the finding cannot hold for every match.
    expect(byId.has('in-dup')).toBe(false);

    expect(response.ambiguity).toBe(true);
    expect(i10.ambiguous).toBe(true);
    expect(ruleCatalogue).toContain(i10);
  });
});
