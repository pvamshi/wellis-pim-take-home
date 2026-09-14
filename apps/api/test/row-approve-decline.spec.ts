import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import {
  LegacyPatientRule,
  type LegacyRuleRow,
  type LegacyRuleStatus,
} from '../src/legacy/legacy-rule.entity';
import type {
  RowApproveAllResponse,
  RowDeclineAllResponse,
} from '../src/row-actions/row-actions.controller';
import { RuleApprovalsService } from '../src/rules/rule-approvals.service';
import { RuleRowDeclinesService } from '../src/rules/rule-row-declines.service';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * The two row-wide presses, Approve all (1.6.4) and Decline all (1.6.5), over
 * HTTP and against a real database.
 *
 * No rules and no registry override anywhere in this suite: neither press
 * runs a rule. What each acts on is rule rows, which are what a run would
 * have left behind, so every fixture is seeded straight through the
 * repository — the same way `approve.spec.ts` and `decline-row.spec.ts` seed
 * the decisions they read.
 *
 * `Rule` and `rule_version` are never touched here, on purpose: neither
 * press's job is to say what the active version of a rule is, and 1.6.5
 * specifically must never reach `rule_version` at all (1.2.8). Every
 * assertion reads the rule table or the legacy data table back, because that
 * pair is the whole of what either press promises.
 *
 * Each test uses a legacy id of its own, so no test's rows are picked up by
 * another's press.
 */

/** The columns a seeded patient sets; the rest default to null. */
interface PatientSeed {
  legacyPatientId: string;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  rawData: string;
}

/** One rule row, as a run would have left it. Pending unless said otherwise. */
interface FindingSeed {
  legacyId: string;
  ruleId: string;
  version?: number;
  column: string;
  previousValue?: string | null;
  nextValue?: string | null;
  status?: LegacyRuleStatus;
  reason?: string | null;
}

describe('the row-wide presses: approve all and decline all', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let patients: Repository<LegacyPatient>;
  let patientRules: Repository<LegacyPatientRule>;
  let approvals: RuleApprovalsService;
  let rowDeclines: RuleRowDeclinesService;

  /** Chunked, so a hundred seed rows stay inside SQLite's parameter limit. */
  async function insertPatients(rows: PatientSeed[]): Promise<void> {
    for (let start = 0; start < rows.length; start += 50) {
      await patients.insert(rows.slice(start, start + 50));
    }
  }

  /** Rule rows a run would have written. Chunked, for SQLite's parameter limit. */
  async function seedFindings(rows: FindingSeed[]): Promise<void> {
    const complete = rows.map((row) => ({
      version: 1,
      previousValue: null,
      nextValue: null,
      status: 'pending' as LegacyRuleStatus,
      reason: null,
      ...row,
    }));

    for (let start = 0; start < complete.length; start += 50) {
      await patientRules.insert(complete.slice(start, start + 50));
    }
  }

  /** The one legacy patient carrying a legacy id, for the fixtures that have one. */
  async function patient(legacyPatientId: string): Promise<LegacyPatient> {
    const [row] = await patients.find({ where: { legacyPatientId } });

    if (row === undefined) {
      throw new Error(`no legacy patient ${legacyPatientId}`);
    }

    return row;
  }

  /** A rule table's rows for one legacy id, in a fixed order. */
  async function findingsOf(legacyId: string): Promise<LegacyRuleRow[]> {
    return await patientRules.find({
      where: { legacyId },
      order: { ruleId: 'ASC', version: 'ASC', column: 'ASC' },
    });
  }

  /** `(ruleId, column) -> status`, which is what most assertions here are. */
  async function statusesOf(legacyId: string): Promise<string[][]> {
    return (await findingsOf(legacyId)).map((row) => [row.ruleId, row.column, row.status]);
  }

  /** The row-wide tick: every proposing finding on a row, applied at once. */
  async function approveAll(
    legacyId: string,
  ): Promise<{ status: number; body: RowApproveAllResponse }> {
    const response = await request(app.getHttpServer()).post(`/rows/patient/${legacyId}/approve`);

    return { status: response.status, body: response.body as RowApproveAllResponse };
  }

  /** The row-wide cross: every pending finding on a row, declined at once. */
  async function declineAll(
    legacyId: string,
    body?: unknown,
  ): Promise<{ status: number; body: RowDeclineAllResponse }> {
    const req = request(app.getHttpServer()).post(`/rows/patient/${legacyId}/decline`);
    const response = body === undefined ? await req : await req.send(body as object);

    return { status: response.status, body: response.body as RowDeclineAllResponse };
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    // A press with nothing to act on is not an error (1.6.4, 1.6.5), but a
    // malformed table segment still is, and Nest logs the stack of any
    // non-HTTP exception it turns into a 500. Silenced so a passing run's
    // output holds no stack trace that looks like a failure.
    app = moduleRef.createNestApplication({ logger: false });
    // Booting is what creates the tables: `synchronize: true` and no
    // migration step to stand in for it (tech-stack 4.4).
    await app.init();
    dataSource = moduleRef.get(DataSource);
    patients = dataSource.getRepository(LegacyPatient);
    patientRules = dataSource.getRepository(LegacyPatientRule);
    approvals = moduleRef.get(RuleApprovalsService);
    rowDeclines = moduleRef.get(RuleRowDeclinesService);
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
  });

  it('approves every finding that proposes a value and leaves the ambiguous ones pending, reporting the skipped count', async () => {
    await insertPatients([
      {
        legacyPatientId: 'P-0310',
        fullName: 'Vera Smit',
        email: 'vera@old.example',
        phone: '0612345678',
        city: 'Utrecht',
        rawData: '{"id":"P-0310"}',
      },
    ]);
    await seedFindings([
      // Four findings that propose a value (1.6.4's scenario).
      { legacyId: 'P-0310', ruleId: 'R-A1', column: 'full_name', nextValue: 'Vera Smit-Bakker' },
      { legacyId: 'P-0310', ruleId: 'R-A2', column: 'email', nextValue: 'vera@new.example' },
      { legacyId: 'P-0310', ruleId: 'R-A3', column: 'phone', nextValue: '+31612345678' },
      { legacyId: 'P-0310', ruleId: 'R-A4', column: 'city', nextValue: 'Amsterdam' },
      // Two from ambiguous rules, proposing nothing (1.1.12).
      { legacyId: 'P-0310', ruleId: 'R-AMBIG-1', column: 'dob', previousValue: '31-02-2000' },
      { legacyId: 'P-0310', ruleId: 'R-AMBIG-2', column: 'bsn', previousValue: 'not-a-bsn' },
    ]);

    const { status, body } = await approveAll('P-0310');

    // 200 rather than the 201 a POST defaults to: nothing was created at a URL.
    expect(status).toBe(200);
    expect(body).toEqual({
      table: 'patient',
      legacyId: 'P-0310',
      approved: 4,
      updated: 4,
      skipped: 2,
    });

    // The four proposing findings were written and approved.
    expect(await patient('P-0310')).toMatchObject({
      fullName: 'Vera Smit-Bakker',
      email: 'vera@new.example',
      phone: '+31612345678',
      city: 'Amsterdam',
    });
    expect(await statusesOf('P-0310')).toEqual([
      ['R-A1', 'full_name', 'approved'],
      ['R-A2', 'email', 'approved'],
      ['R-A3', 'phone', 'approved'],
      ['R-A4', 'city', 'approved'],
      ['R-AMBIG-1', 'dob', 'pending'],
      ['R-AMBIG-2', 'bsn', 'pending'],
    ]);
  });

  it('leaves a row carrying only ambiguous findings pending, approving and updating nothing', async () => {
    await insertPatients([
      {
        legacyPatientId: 'P-AMBIG-ONLY',
        fullName: 'Wies Peters',
        rawData: '{"id":"P-AMBIG-ONLY"}',
      },
    ]);
    await seedFindings([
      { legacyId: 'P-AMBIG-ONLY', ruleId: 'R-B1', column: 'dob', previousValue: 'bad-date' },
    ]);

    const { body } = await approveAll('P-AMBIG-ONLY');

    // 1.6.4: "a row carrying an ambiguous finding therefore cannot reach
    // Import clean by this button" — nothing is approved, and the finding
    // stays exactly as pending as it started.
    expect(body).toEqual({
      table: 'patient',
      legacyId: 'P-AMBIG-ONLY',
      approved: 0,
      updated: 0,
      skipped: 1,
    });
    expect(await statusesOf('P-AMBIG-ONLY')).toEqual([['R-B1', 'dob', 'pending']]);
  });

  it('approves nothing for a row with no pending finding, or for an unrecognised table', async () => {
    await insertPatients([
      { legacyPatientId: 'P-QUIET', fullName: 'Xander de Boer', rawData: '{"id":"P-QUIET"}' },
    ]);

    const quiet = await approveAll('P-QUIET');
    const response = await request(app.getHttpServer()).post('/rows/nowhere/P-QUIET/approve');

    // Nothing pending is a state, not a fault (the same line `approve.spec.ts`
    // already draws for the rule-level press) — and a table this screen does
    // not recognise is a 400, the same reading `row-detail.controller.ts`'s
    // own `readTable` already gives for the same kind of path segment.
    expect(quiet.status).toBe(200);
    expect(quiet.body).toEqual({
      table: 'patient',
      legacyId: 'P-QUIET',
      approved: 0,
      updated: 0,
      skipped: 0,
    });
    expect(response.status).toBe(400);
  });

  it('declines every pending finding on a row, ambiguous included, storing the given reason', async () => {
    await insertPatients([
      {
        legacyPatientId: 'P-0781',
        fullName: 'Youssef Amrani',
        email: 'youssef@old.example',
        phone: '0698765432',
        city: 'Rotterdam',
        rawData: '{"id":"P-0781"}',
      },
    ]);
    await seedFindings([
      { legacyId: 'P-0781', ruleId: 'R-C1', column: 'full_name', nextValue: 'Youssef Amrani-Dupont' },
      { legacyId: 'P-0781', ruleId: 'R-C2', column: 'email', nextValue: 'youssef@new.example' },
      { legacyId: 'P-0781', ruleId: 'R-C3', column: 'phone', nextValue: '+31698765432' },
      { legacyId: 'P-0781', ruleId: 'R-C4', column: 'city', previousValue: 'Rotterdam' },
      { legacyId: 'P-0781', ruleId: 'R-C5', column: 'dob', previousValue: 'bad-date' },
      { legacyId: 'P-0781', ruleId: 'R-C6', column: 'bsn', previousValue: 'not-a-bsn' },
    ]);

    const { status, body } = await declineAll('P-0781', { reason: 'beyond repair' });

    expect(status).toBe(200);
    expect(body).toEqual({
      table: 'patient',
      legacyId: 'P-0781',
      declined: 6,
      reason: 'beyond repair',
    });

    // Every one of the six moved to declined, ambiguous included (1.6.5), and
    // not one column of the legacy row was written — the cross touches no
    // data at all.
    expect(
      (await findingsOf('P-0781')).every((row) => row.status === 'declined' && row.reason === 'beyond repair'),
    ).toBe(true);
    expect(await patient('P-0781')).toMatchObject({
      fullName: 'Youssef Amrani',
      email: 'youssef@old.example',
      phone: '0698765432',
      city: 'Rotterdam',
    });
  });

  it('declines with no reason when none was given, and never touches rule_version', async () => {
    await insertPatients([
      { legacyPatientId: 'P-NOREASON', fullName: 'Zoe Willems', rawData: '{"id":"P-NOREASON"}' },
    ]);
    await seedFindings([
      { legacyId: 'P-NOREASON', ruleId: 'R-D1', column: 'full_name', nextValue: 'Zoe W.' },
    ]);

    const { body } = await declineAll('P-NOREASON');

    expect(body).toEqual({ table: 'patient', legacyId: 'P-NOREASON', declined: 1, reason: null });
    expect(await statusesOf('P-NOREASON')).toEqual([['R-D1', 'full_name', 'declined']]);

    // 1.6.5: the cross needs no proposal to press, and it parks no version —
    // there is no `rule` or `rule_version` row for this rule id at all, which
    // this press never needed and never wrote.
    const versionRows = await dataSource.query<unknown[]>(
      `SELECT * FROM rule_version WHERE rule_id = 'R-D1'`,
    );

    expect(versionRows).toEqual([]);
  });

  it('declines nothing for a row with no pending finding, or for an unrecognised table', async () => {
    await insertPatients([
      { legacyPatientId: 'P-SETTLED', fullName: 'Amir Yilmaz', rawData: '{"id":"P-SETTLED"}' },
    ]);
    await seedFindings([
      {
        legacyId: 'P-SETTLED',
        ruleId: 'R-E1',
        column: 'full_name',
        nextValue: 'Amir Y.',
        status: 'approved',
      },
    ]);

    const settled = await declineAll('P-SETTLED');
    const response = await request(app.getHttpServer()).post('/rows/nowhere/P-SETTLED/decline');

    expect(settled.body).toEqual({
      table: 'patient',
      legacyId: 'P-SETTLED',
      declined: 0,
      reason: null,
    });
    expect(response.status).toBe(400);
    expect(await statusesOf('P-SETTLED')).toEqual([['R-E1', 'full_name', 'approved']]);
  });

  it('guards the table lookup in the service itself, not only in the controller', async () => {
    // Called directly, bypassing `RowActionsController`'s `readTable` — the
    // same precedent `decline-row.spec.ts` sets for `RuleRowDeclinesService`:
    // an address naming a table no `Map` in either service recognises finds
    // nothing to act on and says so, rather than throwing.
    const approved = await approvals.approveAllOnRow('not-a-real-table', 'P-ANYTHING');
    const declined = await rowDeclines.declineAllOnRow('not-a-real-table', 'P-ANYTHING');

    expect(approved).toEqual({
      table: 'not-a-real-table',
      legacyId: 'P-ANYTHING',
      approved: 0,
      updated: 0,
      skipped: 0,
    });
    expect(declined).toEqual({
      table: 'not-a-real-table',
      legacyId: 'P-ANYTHING',
      declined: 0,
      reason: null,
    });
  });

  it('rejects a reason that is present but not a string', async () => {
    await insertPatients([
      { legacyPatientId: 'P-BADBODY', fullName: 'Bo Hendriks', rawData: '{"id":"P-BADBODY"}' },
    ]);

    const response = await request(app.getHttpServer())
      .post('/rows/patient/P-BADBODY/decline')
      .send({ reason: 42 });

    expect(response.status).toBe(400);
  });
});
