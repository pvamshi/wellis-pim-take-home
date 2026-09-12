import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { declineRule, reviseFromRow } from '../../web/src/api/client';
import type { RuleRowAddress } from '../../web/src/api/types';
import { AppModule } from '../src/app.module';
import { LegacyPatientRule, type LegacyRuleStatus } from '../src/legacy/legacy-rule.entity';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * The decline dialog's two presses, made by the screen's own client (1.2.6,
 * 1.2.8).
 *
 * The dialog is a screen and the screen has no test runner of its own —
 * frontend tests are a stated cut (tech-stack §4.7, deferred D1) — so what is
 * testable about it is the part that crosses the wire: the address each answer
 * posts to, what the answer becomes in the request, and the shape expected
 * back.
 *
 * So this suite calls `apps/web/src/api/client.ts` itself, with `fetch`
 * relayed into a real Nest app on a real database. Nothing here writes a URL or
 * a request body: the arguments are what the dialog hands the panel — the
 * reason exactly as typed, and the row address the panel builds — and
 * everything from there on is the client's own code. A client that dropped the
 * reason, sent it under another name, or posted to the other route fails here,
 * because the assertions are what the press left in the tables.
 *
 * It does not re-test the endpoints. `decline-rule.spec.ts` and
 * `revise-row.spec.ts` own their behaviour exhaustively; what is here is only
 * enough state to prove each press the dialog makes is the press it believes it
 * is — above all that the tick reaches a different route rather than a flag in
 * one body, because a ticked cross that posted to `rows/decline` would decline
 * the row 1.2.8 requires to stay eligible.
 *
 * `declineRow`, the unticked cross, is not exercised here. It is 1.2.7's press,
 * unchanged by this dialog and owned by `decline-row.spec.ts`.
 *
 * Each test uses a rule id of its own, so no test's rows or active version can
 * be picked up by another's press.
 */

/** One request the client made, as it made it. */
interface SentRequest {
  readonly method: string;
  readonly path: string;
  /** The body the client serialized, or undefined when it sent none at all. */
  readonly body: string | undefined;
}

/**
 * The web app sits beside this one while the suite runs from `apps/api`.
 * Walking up finds the repository root from either, so the spec does not
 * hard-code how it was launched.
 *
 * A deliberate copy of `rules-screen-contract.spec.ts`'s readers rather than a
 * shared helper lifted out of it: that file belongs to another task, and the
 * codebase already states its preference for a file-local copy of a small
 * parser over editing a file this one does not own.
 */
function findWebApiDirectory(): string {
  let directory = process.cwd();

  for (;;) {
    const candidate = join(directory, 'apps', 'web', 'src', 'api');

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      throw new Error(`apps/web/src/api was not found above ${process.cwd()}`);
    }

    directory = parent;
  }
}

const typesFile = join(findWebApiDirectory(), 'types.ts');

/** The body of one `export interface <name> { … }`, comments removed. */
function interfaceBody(source: string, path: string, name: string): string {
  const header = `export interface ${name} {`;
  const start = source.indexOf(header);

  if (start === -1) {
    throw new Error(`${path} no longer declares \`${header}\``);
  }

  const end = source.indexOf('\n}', start);

  if (end === -1) {
    throw new Error(`\`${header}\` in ${path} is never closed`);
  }

  return source
    .slice(start + header.length, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/**
 * The names of the fields an interface declares, optional markers kept.
 *
 * Names only, unlike `rules-screen-contract.spec.ts`, which compares the
 * declared type against `typeof` the value as well. It cannot here: the version
 * a revise report carries is `number | null`, and a correct response with a
 * number in it would fail a type comparison against that declaration. What this
 * suite can still say — and what actually breaks a screen — is that a field was
 * renamed, added or dropped on one side only.
 */
function declaredFieldNames(source: string, path: string, name: string): string[] {
  const names: string[] = [];

  for (const line of interfaceBody(source, path, name).split('\n')) {
    const text = line.trim();

    if (text === '') {
      continue;
    }

    const field = /^(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*\??)\s*:\s*(.+);$/.exec(text);

    if (field === null) {
      throw new Error(`Could not read a field declaration from "${text}" in ${path}`);
    }

    names.push(field[1]);
  }

  return names.sort();
}

/** The same list, read off an actual response body. */
function wireFieldNames(body: unknown): string[] {
  return Object.keys(body as Record<string, unknown>).sort();
}

describe('the decline dialog’s presses, made by the screen’s own client', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let previousFetch: typeof fetch;
  let rules: Repository<Rule>;
  let versions: Repository<RuleVersion>;
  let patientRules: Repository<LegacyPatientRule>;
  let ruleVersions: RuleVersionsService;
  const sent: SentRequest[] = [];

  /**
   * The client's `fetch`, pointed at the app under test.
   *
   * The client builds an absolute URL from its own base; only the path of it
   * reaches the server, which is the half a controller serves. The body is
   * forwarded as the exact string the client produced — never re-encoded — so
   * what the endpoint parses is what the browser would have sent, and a press
   * with no body stays a press with no body.
   */
  async function relay(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;

    sent.push({ method, path: url.pathname, body });

    if (method !== 'POST') {
      throw new Error(`This suite relays presses only, and ${method} ${url.pathname} is not one`);
    }

    let call = request(app.getHttpServer()).post(url.pathname);

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

  /** The request the client made last, which is the press under test. */
  function lastSent(): SentRequest {
    const last = sent.at(-1);

    if (last === undefined) {
      throw new Error('The client made no request at all');
    }

    return last;
  }

  /**
   * A rule, one version, active, and one pending finding on `phone`.
   *
   * Returns the address as `RuleRowAddress` — the web app's own declaration —
   * because that is what the panel builds out of a row on the screen and hands
   * to the client, and typing it that way is what makes this the dialog's press
   * rather than a hand-made one.
   */
  async function seedRule(ruleId: string): Promise<RuleRowAddress> {
    await rules.save({
      ruleId,
      ruleName: `${ruleId} name`,
      description: `${ruleId} description`,
      ambiguous: false,
    });
    await versions.insert({ ruleId, version: 1 });
    await ruleVersions.activate(ruleId, 1);
    await patientRules.insert({
      legacyId: `${ruleId}-P1`,
      ruleId,
      version: 1,
      column: 'phone',
      previousValue: '0612345678',
      nextValue: '+31612345678',
      status: 'pending' as LegacyRuleStatus,
      reason: null,
    });

    return { table: 'patient', legacyId: `${ruleId}-P1`, version: 1, column: 'phone' };
  }

  /** The rule's only version row, read straight back off the table. */
  async function versionOf(ruleId: string): Promise<RuleVersion> {
    return await versions.findOneOrFail({ where: { ruleId, version: 1 } });
  }

  /** The seeded rule row, read straight back off the table. */
  async function ruleRowOf(ruleId: string): Promise<LegacyPatientRule> {
    return await patientRules.findOneOrFail({
      where: { legacyId: `${ruleId}-P1`, ruleId, version: 1, column: 'phone' },
    });
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    // Booting is what creates the tables: `synchronize: true` and no migration
    // step to stand in for it (tech-stack §4.4).
    await app.init();
    dataSource = moduleRef.get(DataSource);
    rules = dataSource.getRepository(Rule);
    versions = dataSource.getRepository(RuleVersion);
    patientRules = dataSource.getRepository(LegacyPatientRule);
    ruleVersions = moduleRef.get(RuleVersionsService);
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
    await dataSource.query(`DELETE FROM legacy_patient_rule`);
    await dataSource.query(`DELETE FROM rule_version`);
    await dataSource.query(`DELETE FROM rule`);
  });

  it('parks the rule with the reason typed into the box (1.2.6, first scenario)', async () => {
    await seedRule('R-DIALOG-RULE');

    // Decline on the rule, answered with a reason: the two arguments the dialog
    // produces. The address and the body are the client's from here on.
    await declineRule('R-DIALOG-RULE', 'It matched Belgian numbers too');

    expect({ method: lastSent().method, path: lastSent().path }).toEqual({
      method: 'POST',
      path: '/rules/R-DIALOG-RULE/decline',
    });

    // 1.2.6's first scenario, read off the row rather than off the report. The
    // reason is on the version because the client put it on the wire; drop it
    // there and this is null.
    const parked = await versionOf('R-DIALOG-RULE');

    expect({
      status: parked.status,
      needsReview: parked.needsReview,
      reason: parked.reason,
    }).toEqual({
      status: 'inactive',
      needsReview: true,
      reason: 'It matched Belgian numbers too',
    });
  });

  it('records no reason when the box was left empty (1.2.6, second scenario)', async () => {
    // An untouched box is `''`, and a box holding only spaces is the same press
    // — nobody said anything. Both must reach the backend as one request: no
    // reason field at all, rather than a stored blank.
    const presses: readonly [string, string][] = [
      ['R-DIALOG-EMPTY', ''],
      ['R-DIALOG-SPACES', '   '],
    ];

    for (const [ruleId, typed] of presses) {
      await seedRule(ruleId);
      await declineRule(ruleId, typed);

      // No body at all is what "no reason" is on the wire, and it is the client
      // that decides so. Send `{ reason: '   ' }` instead and this fails.
      expect({ path: lastSent().path, body: lastSent().body }).toEqual({
        path: `/rules/${ruleId}/decline`,
        body: undefined,
      });

      // And that request is a decline the backend accepts, not a 400: the rule
      // is parked with nothing recorded in place of a reason.
      const parked = await versionOf(ruleId);

      expect({
        status: parked.status,
        needsReview: parked.needsReview,
        reason: parked.reason,
      }).toEqual({ status: 'inactive', needsReview: true, reason: null });
    }
  });

  it('sends the rule for revision with the tick, leaving the row pending (1.2.8)', async () => {
    const address = await seedRule('R-DIALOG-TICKED');

    // The ticked cross: the same row address as the unticked one, the same
    // reason box, and a different press entirely.
    const report = await reviseFromRow(
      'R-DIALOG-TICKED',
      address,
      'The rule is wrong, this row is the evidence',
    );

    expect({ method: lastSent().method, path: lastSent().path }).toEqual({
      method: 'POST',
      path: '/rules/R-DIALOG-TICKED/rows/revise',
    });

    // 1.2.8's two halves. The rule stops: its active version is parked, with
    // the reason stored against the version.
    const parked = await versionOf('R-DIALOG-TICKED');

    expect({
      status: parked.status,
      needsReview: parked.needsReview,
      reason: parked.reason,
    }).toEqual({
      status: 'inactive',
      needsReview: true,
      reason: 'The rule is wrong, this row is the evidence',
    });

    // The row that exposed it does not: still pending, carrying none of the
    // reason, so the version that replaces the rule proposes on it again. This
    // is also what says the tick took the other route — posted to
    // `rows/decline`, the same address and reason would have settled this row
    // and left the version active.
    const row = await ruleRowOf('R-DIALOG-TICKED');

    expect({ status: row.status, reason: row.reason }).toEqual({ status: 'pending', reason: null });

    // The address came back exactly as the press named it. Nothing was written
    // from it (1.2.8) — it is how the caller sees the press it made landed.
    expect(report.row).toEqual(address);
  });

  it('answers a revise report carrying exactly the fields the screen declares it reads', async () => {
    const address = await seedRule('R-DIALOG-SHAPE');

    // The value the client returns is the response body it parsed, so these are
    // the keys the panel's outcome line reads.
    const report = await reviseFromRow('R-DIALOG-SHAPE', address, 'shape');

    // Name for name, on the report and on the address it echoes back. Rename,
    // add or drop a field on either side and this fails with both spellings
    // printed, rather than the outcome line rendering `undefined`.
    const types = readFileSync(typesFile, 'utf8');

    expect(declaredFieldNames(types, typesFile, 'ReviseFromRowReport')).toEqual(
      wireFieldNames(report),
    );
    expect(declaredFieldNames(types, typesFile, 'RuleRowAddress')).toEqual(
      wireFieldNames(report.row),
    );
  });
});
