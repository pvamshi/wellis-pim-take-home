import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { i03 } from '../src/rules/catalogue/i03';
import { createRuleContext } from '../src/rules/rule-context';
import { ruleCatalogue } from '../src/rules/rule-catalogue';
import type { RuleContext } from '../src/rules/rule-contract';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('I03 — an intake patient reference with whitespace around it', () => {
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
      { legacyIntakeId: 'in-lead', legacyPatientId: ' rec123', rawData: '{}' },
      { legacyIntakeId: 'in-trail', legacyPatientId: 'rec456 ', rawData: '{}' },
      { legacyIntakeId: 'in-clean', legacyPatientId: 'rec789', rawData: '{}' },
      // Trims away to nothing — I05's finding, not invented here.
      { legacyIntakeId: 'in-blank', legacyPatientId: '   ', rawData: '{}' },
      { legacyIntakeId: 'in-null', legacyPatientId: null, rawData: '{}' },
    ]);
  });

  afterAll(async () => {
    await app.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    database.cleanup();
  });

  it('proposes the trimmed patient id, addressed by the intake, and leaves the rest alone', async () => {
    const response = await i03.run(context);
    const byId = new Map(response.updates.map((update) => [update.legacyId, update]));

    expect(byId.get('in-lead')).toEqual({
      table: 'intake',
      legacyId: 'in-lead',
      column: 'legacy_patient_id',
      prev: ' rec123',
      next: 'rec123',
    });
    expect(byId.get('in-trail')?.next).toBe('rec456');

    expect(byId.has('in-clean')).toBe(false);
    expect(byId.has('in-blank')).toBe(false);
    expect(byId.has('in-null')).toBe(false);

    expect(response.ambiguity).toBe(false);
    expect(i03.ambiguous).toBe(false);
    expect(ruleCatalogue).toContain(i03);
  });
});
