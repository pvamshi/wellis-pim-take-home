import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { LegacyPatientRule, type LegacyRuleRow } from '../src/legacy/legacy-rule.entity';
import type { RowEditResponse } from '../src/row-edit/row-edit.controller';
import { HAND_EDIT_RULE_ID } from '../src/rules/row-edit.service';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * A field corrected by hand (1.6.7), over HTTP and against a real database.
 *
 * No rule and no registry runs here, the same reason `row-approve-decline.spec.ts`
 * gives for its own suite: an edit's write path never runs a rule, it only
 * writes the legacy data table and the rule tables this endpoint owns. Every
 * fixture is seeded straight through the repositories.
 *
 * Each test uses a legacy id of its own, so no test's rows are picked up by
 * another's edit.
 */

/** The columns a seeded patient sets; the rest default to null. */
interface PatientSeed {
  legacyPatientId: string;
  fullName?: string | null;
  email?: string | null;
  city?: string | null;
  rawData: string;
}

describe('a field corrected by hand', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let patients: Repository<LegacyPatient>;
  let patientRules: Repository<LegacyPatientRule>;
  let rules: Repository<Rule>;

  async function insertPatients(rows: PatientSeed[]): Promise<void> {
    await patients.insert(rows.map((row) => ({ email: null, city: null, ...row })));
  }

  async function patient(legacyPatientId: string): Promise<LegacyPatient> {
    const [row] = await patients.find({ where: { legacyPatientId } });

    if (row === undefined) {
      throw new Error(`no legacy patient ${legacyPatientId}`);
    }

    return row;
  }

  async function findingsOf(legacyId: string): Promise<LegacyRuleRow[]> {
    return await patientRules.find({
      where: { legacyId },
      order: { version: 'ASC' },
    });
  }

  async function edit(
    legacyId: string,
    body: unknown,
  ): Promise<{ status: number; body: RowEditResponse }> {
    const response = await request(app.getHttpServer())
      .post(`/rows/patient/${legacyId}/edit`)
      .send(body as object);

    return { status: response.status, body: response.body as RowEditResponse };
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    // A malformed body or table segment is still a 400, and Nest logs the
    // stack of any non-HTTP exception it turns into a 500. Silenced so a
    // passing run's output holds no stack trace that looks like a failure.
    app = moduleRef.createNestApplication({ logger: false });
    // Booting is what creates the tables: `synchronize: true` and no
    // migration step to stand in for it (tech-stack 4.4).
    await app.init();
    dataSource = moduleRef.get(DataSource);
    patients = dataSource.getRepository(LegacyPatient);
    patientRules = dataSource.getRepository(LegacyPatientRule);
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
    await dataSource.query(`DELETE FROM legacy_patient_rule`);
    await dataSource.query(`DELETE FROM legacy_patient`);
    await dataSource.query(`DELETE FROM rule_version`);
    await dataSource.query(`DELETE FROM rule`);
  });

  it('writes the column and leaves an approved finding naming the reserved rule, with both values', async () => {
    await insertPatients([
      {
        legacyPatientId: 'P-0310',
        fullName: 'Vera Smit',
        city: 'Old Town',
        rawData: '{"id":"P-0310"}',
      },
    ]);

    const { status, body } = await edit('P-0310', { column: 'city', value: 'Utrecht' });

    // 200 rather than the 201 a POST defaults to: nothing was created at a URL.
    expect(status).toBe(200);
    expect(body).toEqual({
      table: 'patient',
      legacyId: 'P-0310',
      column: 'city',
      previousValue: 'Old Town',
      nextValue: 'Utrecht',
      ruleId: HAND_EDIT_RULE_ID,
      version: 1,
    });

    // The column itself was written.
    expect(await patient('P-0310')).toMatchObject({ city: 'Utrecht' });

    // And the modification log (1.3) carries one approved finding for it,
    // naming the reserved rule.
    const findings = await findingsOf('P-0310');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: HAND_EDIT_RULE_ID,
      version: 1,
      column: 'city',
      previousValue: 'Old Town',
      nextValue: 'Utrecht',
      status: 'approved',
    });

    // The reserved rule row itself reads to a human in the console.
    const rule = await rules.findOne({ where: { ruleId: HAND_EDIT_RULE_ID } });
    expect(rule).not.toBeNull();
    expect(rule?.ambiguous).toBe(false);
    expect(rule?.ruleName.length).toBeGreaterThan(0);
    expect(rule?.description.length).toBeGreaterThan(0);
  });

  it('records a second finding rather than overwriting the first, on a second edit of the same column', async () => {
    await insertPatients([
      {
        legacyPatientId: 'P-TWICE',
        fullName: 'Bo Hendriks',
        city: 'First City',
        rawData: '{"id":"P-TWICE"}',
      },
    ]);

    const first = await edit('P-TWICE', { column: 'city', value: 'Second City' });
    const second = await edit('P-TWICE', { column: 'city', value: 'Third City' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.version).toBe(1);
    expect(second.body.version).toBe(2);
    expect(first.body.previousValue).toBe('First City');
    expect(second.body.previousValue).toBe('Second City');

    // Only the latest value is on the row itself...
    expect(await patient('P-TWICE')).toMatchObject({ city: 'Third City' });

    // ...but both findings remain, distinct rows rather than one overwritten.
    const findings = await findingsOf('P-TWICE');
    expect(findings).toHaveLength(2);
    expect(findings.map((row) => [row.version, row.previousValue, row.nextValue, row.status])).toEqual([
      [1, 'First City', 'Second City', 'approved'],
      [2, 'Second City', 'Third City', 'approved'],
    ]);

    // The reserved rule row was inserted once and reused, not duplicated.
    const ruleRows = await rules.find({ where: { ruleId: HAND_EDIT_RULE_ID } });
    expect(ruleRows).toHaveLength(1);
  });

  it('is a 400 and writes nothing for a column the entity does not have', async () => {
    await insertPatients([
      { legacyPatientId: 'P-NOFIELD', fullName: 'Amir Yilmaz', rawData: '{"id":"P-NOFIELD"}' },
    ]);

    const { status } = await edit('P-NOFIELD', { column: 'not_a_real_column', value: 'anything' });

    expect(status).toBe(400);
    expect(await patient('P-NOFIELD')).toMatchObject({ fullName: 'Amir Yilmaz' });
    expect(await findingsOf('P-NOFIELD')).toEqual([]);
  });

  it('is a 400 and writes nothing for each of the three columns 1.6.7 does not let a hand edit touch', async () => {
    await insertPatients([
      { legacyPatientId: 'P-GUARDED', fullName: 'Zoe Willems', rawData: '{"id":"P-GUARDED"}' },
    ]);

    const idAttempt = await edit('P-GUARDED', { column: 'id', value: 'anything' });
    const legacyIdAttempt = await edit('P-GUARDED', { column: 'legacy_id', value: 'P-OTHER' });
    const rawDataAttempt = await edit('P-GUARDED', { column: 'raw_data', value: '{}' });

    expect(idAttempt.status).toBe(400);
    expect(legacyIdAttempt.status).toBe(400);
    expect(rawDataAttempt.status).toBe(400);
    expect(await findingsOf('P-GUARDED')).toEqual([]);
  });

  it('answers 404 for a legacy id the data table has never seen, and writes nothing', async () => {
    const { status } = await edit('P-GHOST', { column: 'city', value: 'Anywhere' });

    expect(status).toBe(404);
    expect(await findingsOf('P-GHOST')).toEqual([]);
  });

  it('rejects a table that is not one of the three legacy sources', async () => {
    const response = await request(app.getHttpServer())
      .post('/rows/nowhere/P-ANYTHING/edit')
      .send({ column: 'city', value: 'Anywhere' });

    expect(response.status).toBe(400);
  });

  it('requires a value: omitting it is a 400, but null clears the column', async () => {
    await insertPatients([
      {
        legacyPatientId: 'P-CLEAR',
        fullName: 'Xander de Boer',
        city: 'Somewhere',
        rawData: '{"id":"P-CLEAR"}',
      },
    ]);

    const missing = await edit('P-CLEAR', { column: 'city' });
    expect(missing.status).toBe(400);
    expect(await patient('P-CLEAR')).toMatchObject({ city: 'Somewhere' });

    const cleared = await edit('P-CLEAR', { column: 'city', value: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ previousValue: 'Somewhere', nextValue: null });
    expect(await patient('P-CLEAR')).toMatchObject({ city: null });
  });

  it('writes every physical row sharing a legacy id (1.0.3), reading previousValue off the first', async () => {
    await insertPatients([
      { legacyPatientId: 'P-DUP', fullName: 'First Physical Row', city: 'A', rawData: '{}' },
      { legacyPatientId: 'P-DUP', fullName: 'Second Physical Row', city: 'B', rawData: '{}' },
    ]);

    const rowsBefore = await patients.find({ where: { legacyPatientId: 'P-DUP' }, order: { id: 'ASC' } });

    const { status, body } = await edit('P-DUP', { column: 'city', value: 'Shared' });

    expect(status).toBe(200);
    expect(body.previousValue).toBe(rowsBefore[0].city);

    const rowsAfter = await patients.find({ where: { legacyPatientId: 'P-DUP' } });
    expect(rowsAfter.every((row) => row.city === 'Shared')).toBe(true);
  });
});
