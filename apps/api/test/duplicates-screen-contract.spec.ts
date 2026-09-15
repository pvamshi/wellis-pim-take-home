import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  confirmDuplicate,
  dismissDuplicate,
  getDuplicateDetail,
  getDuplicates,
} from '../../web/src/api/client';
import { AppModule } from '../src/app.module';
import { Duplicate } from '../src/duplicates/duplicate.entity';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * The agreement between the duplicates endpoints and the screen that reads
 * them (1.7.4-1.7.6) — this screen's own version of what
 * `rules-screen-contract.spec.ts` already holds `GET /rules` to, and
 * `apply-rules-button-contract.spec.ts`'s own choice of calling the screen's
 * client rather than the endpoint directly.
 *
 * `apps/web/src/api/types.ts` restates `GET /duplicates`, `GET
 * /duplicates/:id` and the two POST reports by hand, because the workspaces
 * are `apps/*` only and there is no shared package for the two sides to
 * import one interface from. A restatement is a copy that can silently stop
 * being true: rename a field on either side and every build, lint and test
 * elsewhere in the repository still passes while the screen renders
 * `undefined`. This suite is what notices.
 *
 * Unlike `rules-screen-contract.spec.ts`'s own comparison, this one checks
 * field *names* only, not declared type text against `typeof`. Every
 * response here nests an object (`DuplicateDetail.duplicate`), is typed
 * through a named alias (`table: LegacySourceTable`) or carries a literal
 * type (`outcome: 'confirmed'`) — none of which `typeof` can ever equal, the
 * same reason `apply-rules-button-contract.spec.ts` falls back to comparing
 * `Object.keys` for `ApplyRulesReport` rather than its own flat
 * `ApplyRulesTotals`/`ApplyRulesRuleLine`. A field added, dropped or renamed
 * on either side still fails this suite; only a type narrowed on a field
 * that keeps its name would not.
 *
 * Calls go through `apps/web/src/api/client.ts` itself — `getDuplicates`,
 * `getDuplicateDetail`, `confirmDuplicate`, `dismissDuplicate` — with
 * `fetch` relayed into a real Nest app on a real database, the same
 * technique `apply-rules-button-contract.spec.ts` uses. That is what proves
 * the client calls the address a controller actually serves, not only that
 * the two field lists agree.
 */

/** One request the client made, as it made it. */
interface SentRequest {
  readonly method: string;
  readonly path: string;
}

/**
 * The web app sits beside this one while the suite runs from `apps/api`. A
 * deliberate copy of the same walk `rules-screen-contract.spec.ts` and
 * `apply-rules-button-contract.spec.ts` already make, rather than a shared
 * helper lifted out of files this task does not own.
 */
function findWebSourceDirectory(): string {
  let directory = process.cwd();

  for (;;) {
    const candidate = join(directory, 'apps', 'web', 'src');

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      throw new Error(`apps/web/src was not found above ${process.cwd()}`);
    }

    directory = parent;
  }
}

const typesFile = join(findWebSourceDirectory(), 'api', 'types.ts');

/** The body of one `export interface <name> { … }`, comments removed. */
function interfaceBody(source: string, name: string): string {
  const header = `export interface ${name} {`;
  const start = source.indexOf(header);

  if (start === -1) {
    throw new Error(`${typesFile} no longer declares \`${header}\``);
  }

  const end = source.indexOf('\n}', start);

  if (end === -1) {
    throw new Error(`\`${header}\` in ${typesFile} is never closed`);
  }

  return source
    .slice(start + header.length, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/** Every field name one interface declares (optional marker kept), sorted. */
function declaredFieldNames(source: string, name: string): string[] {
  const names: string[] = [];

  for (const line of interfaceBody(source, name).split('\n')) {
    const text = line.trim();

    if (text === '') {
      continue;
    }

    const field = /^(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*\??)\s*:/.exec(text);

    if (field === null) {
      throw new Error(`Could not read a field declaration from "${text}" in ${typesFile}`);
    }

    names.push(field[1]);
  }

  return names.sort();
}

/** The same shape, read off an actual response value. */
function wireFieldNames(value: unknown): string[] {
  return Object.keys(value as Record<string, unknown>).sort();
}

describe('the duplicates screen’s contract with GET /duplicates, GET /duplicates/:id and the two decisions', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let previousFetch: typeof fetch;
  let duplicates: Repository<Duplicate>;
  let rules: Repository<Rule>;
  let patients: Repository<LegacyPatient>;
  let intakes: Repository<LegacyIntake>;
  const sent: SentRequest[] = [];
  const types = readFileSync(typesFile, 'utf8');

  /**
   * The client's `fetch`, pointed at the app under test — a deliberate copy
   * of `apply-rules-button-contract.spec.ts`'s own relay, for the same
   * reason that file gives for not sharing it.
   */
  async function relay(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;

    sent.push({ method, path: url.pathname });

    if (method !== 'GET' && method !== 'POST') {
      throw new Error(`This suite relays GET and POST only, and ${method} ${url.pathname} is not`);
    }

    let call =
      method === 'GET'
        ? request(app.getHttpServer()).get(url.pathname)
        : request(app.getHttpServer()).post(url.pathname);

    if (body !== undefined) {
      const contentType = new Headers(init?.headers).get('content-type');
      call = call.set('Content-Type', contentType ?? 'application/json').send(body);
    }

    const response = await call;
    const text =
      typeof response.text === 'string' && response.text !== ''
        ? response.text
        : JSON.stringify(response.body);

    return new Response(text, {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  function lastSent(): SentRequest {
    const last = sent.at(-1);

    if (last === undefined) {
      throw new Error('The client made no request at all');
    }

    return last;
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    dataSource = moduleRef.get(DataSource);
    duplicates = dataSource.getRepository(Duplicate);
    rules = dataSource.getRepository(Rule);
    patients = dataSource.getRepository(LegacyPatient);
    intakes = dataSource.getRepository(LegacyIntake);
    previousFetch = globalThis.fetch;
    globalThis.fetch = relay as typeof fetch;
  });

  afterAll(async () => {
    globalThis.fetch = previousFetch;
    await app.close();

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }

    database.cleanup();
  });

  beforeEach(async () => {
    sent.length = 0;
    await dataSource.query(`DELETE FROM duplicate`);
    await dataSource.query(`DELETE FROM legacy_patient`);
    await dataSource.query(`DELETE FROM legacy_intake`);
    await dataSource.query(`DELETE FROM rule`);
  });

  it('GET /duplicates: the client calls /duplicates and the response carries exactly the field names the screen declares', async () => {
    await rules.insert({
      ruleId: 'D01',
      ruleName: 'D01 name',
      description: 'D01 description',
      ambiguous: false,
    });
    await duplicates.insert({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-450',
      duplicateRowId: 'row-450',
      canonicalLegacyId: 'P-100',
      canonicalRowId: 'row-100',
      ruleId: 'D01',
      version: 1,
      status: 'pending',
    });

    const response = await getDuplicates();

    expect(lastSent()).toEqual({ method: 'GET', path: '/duplicates' });
    expect(response.total).toBe(1);
    expect(wireFieldNames(response)).toEqual(declaredFieldNames(types, 'DuplicatesListResponse'));
    expect(wireFieldNames(response.links[0])).toEqual(declaredFieldNames(types, 'DuplicateListEntry'));
  });

  it('GET /duplicates/:id: the client calls the link’s own address and both sides carry the declared field names', async () => {
    await rules.insert({
      ruleId: 'D01',
      ruleName: 'D01 name',
      description: 'D01 description',
      ambiguous: false,
    });
    const duplicateRow = await patients.insert({
      legacyPatientId: 'P-450',
      fullName: 'A. Vries',
      rawData: '{}',
    });
    const canonicalRow = await patients.insert({
      legacyPatientId: 'P-100',
      fullName: 'Ana de Vries',
      rawData: '{}',
    });
    const link = await duplicates.insert({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-450',
      duplicateRowId: duplicateRow.identifiers[0].id as string,
      canonicalLegacyId: 'P-100',
      canonicalRowId: canonicalRow.identifiers[0].id as string,
      ruleId: 'D01',
      version: 1,
      status: 'pending',
    });
    const id = link.identifiers[0].id as string;

    const detail = await getDuplicateDetail(id);

    expect(lastSent()).toEqual({ method: 'GET', path: `/duplicates/${id}` });
    expect(wireFieldNames(detail)).toEqual(declaredFieldNames(types, 'DuplicateDetail'));
    expect(wireFieldNames(detail.duplicate)).toEqual(declaredFieldNames(types, 'DuplicateDetailRow'));
    expect(wireFieldNames(detail.canonical)).toEqual(declaredFieldNames(types, 'DuplicateDetailRow'));
  });

  it('POST /duplicates/:id/confirm: the client posts to the link’s own address and the report carries the declared field names, for a patient link and for an intake link', async () => {
    await rules.insert({
      ruleId: 'D01',
      ruleName: 'D01 name',
      description: 'D01 description',
      ambiguous: false,
    });
    await rules.insert({
      ruleId: 'D05',
      ruleName: 'D05 name',
      description: 'D05 description',
      ambiguous: false,
    });
    await patients.insert({ legacyPatientId: 'P-450', rawData: '{}' });
    await patients.insert({ legacyPatientId: 'P-100', rawData: '{}' });
    const first = await intakes.insert({ legacyIntakeId: 'I-900', rawData: '{}' });
    const second = await intakes.insert({ legacyIntakeId: 'I-900', rawData: '{}' });

    const patientLink = await duplicates.insert({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-450',
      duplicateRowId: 'row-450',
      canonicalLegacyId: 'P-100',
      canonicalRowId: 'row-100',
      ruleId: 'D01',
      version: 1,
      status: 'pending',
    });
    const patientId = patientLink.identifiers[0].id as string;

    const intakeLink = await duplicates.insert({
      sourceTable: 'intake',
      duplicateLegacyId: 'I-900',
      duplicateRowId: second.identifiers[0].id as string,
      canonicalLegacyId: 'I-900',
      canonicalRowId: first.identifiers[0].id as string,
      ruleId: 'D05',
      version: 1,
      status: 'pending',
    });
    const intakeId = intakeLink.identifiers[0].id as string;

    const patientReport = await confirmDuplicate(patientId);
    expect(lastSent()).toEqual({ method: 'POST', path: `/duplicates/${patientId}/confirm` });
    expect(patientReport.rejected).toBe(true);
    expect(wireFieldNames(patientReport)).toEqual(declaredFieldNames(types, 'DuplicateConfirmReport'));

    const intakeReport = await confirmDuplicate(intakeId);
    expect(lastSent()).toEqual({ method: 'POST', path: `/duplicates/${intakeId}/confirm` });
    expect(intakeReport.rejected).toBe(false);
    expect(wireFieldNames(intakeReport)).toEqual(declaredFieldNames(types, 'DuplicateConfirmReport'));
  });

  it('POST /duplicates/:id/dismiss: the client posts to the link’s own address and the report carries the declared field names', async () => {
    await rules.insert({
      ruleId: 'D01',
      ruleName: 'D01 name',
      description: 'D01 description',
      ambiguous: false,
    });
    const link = await duplicates.insert({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-1',
      duplicateRowId: 'row-1',
      canonicalLegacyId: 'P-2',
      canonicalRowId: 'row-2',
      ruleId: 'D01',
      version: 1,
      status: 'pending',
    });
    const id = link.identifiers[0].id as string;

    const report = await dismissDuplicate(id);

    expect(lastSent()).toEqual({ method: 'POST', path: `/duplicates/${id}/dismiss` });
    expect(wireFieldNames(report)).toEqual(declaredFieldNames(types, 'DuplicateDismissReport'));
  });

  it('the screen reaches these endpoints through the client, not through a raw fetch of its own', async () => {
    const page = readFileSync(join(findWebSourceDirectory(), 'pages', 'DuplicatesPage.tsx'), 'utf8');
    const panel = readFileSync(
      join(findWebSourceDirectory(), 'components', 'DuplicateDetailPanel.tsx'),
      'utf8',
    );

    expect(page).toMatch(/import \{[^}]*\bgetDuplicates\b[^}]*\} from '\.\.\/api\/client';/);
    expect(page).not.toContain('fetch(');
    expect(panel).toMatch(/import \{[^}]*\bgetDuplicateDetail\b[^}]*\} from '\.\.\/api\/client';/);
    expect(panel).toMatch(/\bconfirmDuplicate\b/);
    expect(panel).toMatch(/\bdismissDuplicate\b/);
    expect(panel).not.toContain('fetch(');
  });
});
