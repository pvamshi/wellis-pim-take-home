import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, applyRules, getRules } from '../../web/src/api/client';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import type { RegisteredRule, RuleFunction } from '../src/rules/rule-contract';
import { RuleRegistry } from '../src/rules/rule-registry';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * The "Apply rules" button, pressed through the screen's own client (1.2.10).
 *
 * The button is a screen and the screen has no test runner of its own —
 * frontend tests are a stated cut (tech-stack §4.7, deferred D1) — so what is
 * testable about it is the part that crosses the wire: the address the press
 * posts to, that it carries no body, what comes back for the run summary to be
 * built from, and the re-read the button then performs.
 *
 * So this suite calls `apps/web/src/api/client.ts` itself, with `fetch` relayed
 * into a real Nest app on a real database. Nothing here writes a URL or a
 * request body: `applyRules()` and `getRules()` are the two calls the button
 * makes, and everything from there on is the client's own code. A press that
 * posted elsewhere, sent a body, or parsed the answer under other names fails
 * here, because the assertions are what the run left in the tables and what the
 * list then reports.
 *
 * It does not re-test the endpoint. `apply-rules.spec.ts` owns `POST
 * /rules/apply` exhaustively — the whole dataset, an inactive version, a second
 * press, a declined row, an empty run. What is here is only enough of a run to
 * prove the press reaches both halves of it and that the refresh reads the
 * results of the run just made.
 *
 * Fake rules, because this body of work is the infrastructure rules run on and
 * not the rules; they arrive through the registry the runner injects, which is
 * the wiring real rules will use. Each test activates a rule id of its own, so
 * one test's active version can never be picked up by another's press.
 */

/** One request the client made, as it made it. */
interface SentRequest {
  readonly method: string;
  readonly path: string;
  /** The body the client serialized, or undefined when it sent none at all. */
  readonly body: string | undefined;
}

/** A row of a rule table as the driver returns it, columns and all. */
type StoredRow = Record<string, unknown>;

/** The columns a seeded patient sets; the rest default to null. */
interface PatientSeed {
  legacyPatientId: string;
  fullName: string | null;
  email: string | null;
  dob: string | null;
  phone: string | null;
  city: string | null;
  rawData: string;
}

/**
 * The web app sits beside this one while the suite runs from `apps/api`.
 * Walking up finds the repository root from either, so the spec does not
 * hard-code how it was launched.
 *
 * A deliberate copy of the readers in `rules-screen-contract.spec.ts` and
 * `decline-dialog-contract.spec.ts` rather than a shared helper lifted out of
 * them: those files belong to other tasks, and the codebase already states its
 * preference for a file-local copy of a small parser over editing a file this
 * one does not own.
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

const webSourceDirectory = findWebSourceDirectory();
const typesFile = join(webSourceDirectory, 'api', 'types.ts');
const rulesPageFile = join(webSourceDirectory, 'pages', 'RulesPage.tsx');

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
 * Every field an interface declares, as declared-name to declared-type.
 *
 * `readonly` is dropped because it says nothing about the wire, but an optional
 * marker is kept on the name: a field the screen has made optional is no longer
 * the same expectation as the one the endpoint always sends.
 */
function declaredFields(source: string, path: string, name: string): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const line of interfaceBody(source, path, name).split('\n')) {
    const text = line.trim();

    if (text === '') {
      continue;
    }

    const field = /^(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*\??)\s*:\s*(.+);$/.exec(text);

    if (field === null) {
      throw new Error(`Could not read a field declaration from "${text}" in ${path}`);
    }

    fields[field[1]] = field[2].trim();
  }

  return fields;
}

/** The same shape, read off an actual response: name to `typeof` the value. */
function wireFields(body: unknown): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const [name, value] of Object.entries(body as Record<string, unknown>)) {
    fields[name] = typeof value;
  }

  return fields;
}

/** Proposes the international form of every Dutch number written the old way. */
const proposePhone: RuleFunction = async (context) => {
  const patients = await context.find(LegacyPatient);

  return {
    ambiguity: false,
    updates: patients
      .filter((patient) => patient.phone?.startsWith('06') === true)
      .map((patient) => ({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'phone',
        prev: patient.phone,
        next: `+31${patient.phone?.slice(1) ?? ''}`,
      })),
  };
};

/** Every fake this suite registers. `R-BTN-BROKEN` is deliberately absent. */
const fakeRules: RegisteredRule[] = [
  { ruleId: 'R-BTN-PRESS', version: 1, run: proposePhone },
  { ruleId: 'R-BTN-RUN', version: 1, run: proposePhone },
  { ruleId: 'R-BTN-LIST', version: 1, run: proposePhone },
  { ruleId: 'R-BTN-SHAPE', version: 1, run: proposePhone },
];

/**
 * The patients every test starts from. Two of the three match the fake.
 *
 * A function rather than a constant, because inserting writes the generated id
 * back into the object it was handed, and a shared object carrying a stale id
 * would be updated instead of inserted on the next test.
 */
function fixedPatients(): PatientSeed[] {
  return [
    {
      legacyPatientId: 'P-1',
      fullName: 'Ana de Vries',
      email: 'ana@new.example',
      dob: '03/07/1984',
      phone: '0612345678',
      city: 'Utrecht',
      rawData: '{"id":"P-1"}',
    },
    {
      legacyPatientId: 'P-2',
      fullName: 'Bram Jansen',
      email: 'bram@old.example',
      dob: '1984-07-03',
      phone: '+31612345679',
      city: 'Amsterdam',
      rawData: '{"id":"P-2"}',
    },
    {
      legacyPatientId: 'P-3',
      fullName: 'Cas Bakker',
      email: 'cas@new.example',
      dob: '11/12/1990',
      phone: '0698765432',
      city: 'Rotterdam',
      rawData: '{"id":"P-3"}',
    },
  ];
}

describe('the “Apply rules” button, pressed by the screen’s own client', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let previousFetch: typeof fetch;
  let patients: Repository<LegacyPatient>;
  let rules: Repository<Rule>;
  let versions: Repository<RuleVersion>;
  let ruleVersions: RuleVersionsService;
  const sent: SentRequest[] = [];

  /**
   * The client's `fetch`, pointed at the app under test.
   *
   * The client builds an absolute URL from its own base; only the path of it
   * reaches the server, which is the half a controller serves. The body is
   * forwarded as the exact string the client produced — never re-encoded — so a
   * press with no body stays a press with no body.
   *
   * Unlike `decline-dialog-contract.spec.ts`'s relay this one forwards GET as
   * well: the re-read the button performs after a run is part of what is under
   * test, and it is a GET.
   */
  async function relay(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;

    sent.push({ method, path: url.pathname, body });

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

  /** The request the client made last, which is the press under test. */
  function lastSent(): SentRequest {
    const last = sent.at(-1);

    if (last === undefined) {
      throw new Error('The client made no request at all');
    }

    return last;
  }

  /** A rule with one version, made the active one (1.1.8). */
  async function seedRule(ruleId: string): Promise<void> {
    await rules.save({
      ruleId,
      ruleName: `${ruleId} name`,
      description: `${ruleId} description`,
      ambiguous: false,
    });
    await versions.insert({ ruleId, version: 1 });
    await ruleVersions.activate(ruleId, 1);
  }

  /** A rule table exactly as it stands, every column of every row. */
  async function storedRows(table: string): Promise<StoredRow[]> {
    return await dataSource.query<StoredRow[]>(
      `SELECT * FROM ${table} ORDER BY legacy_id, rule_id, version, "column"`,
    );
  }

  /** How many rows each of the three rule tables holds. */
  async function ruleRowCounts(): Promise<number[]> {
    const counts: number[] = [];

    for (const table of ['legacy_patient_rule', 'legacy_intake_rule', 'legacy_consent_rule']) {
      const [counted] = await dataSource.query<{ rows: number }[]>(
        `SELECT COUNT(*) AS rows FROM ${table}`,
      );

      counts.push(counted?.rows ?? -1);
    }

    return counts;
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // The catalogue ships empty on purpose, so the fakes arrive the way real
      // rules will: through the registry the runner injects.
      .overrideProvider(RuleRegistry)
      .useValue(new RuleRegistry(fakeRules))
      .compile();

    // One test deliberately makes a rule version unresolvable, and Nest logs
    // the stack of any non-HTTP exception it turns into a 500. Silenced so a
    // passing run's output holds no stack trace that looks like a failure.
    app = moduleRef.createNestApplication({ logger: false });
    // Booting is what creates the tables: `synchronize: true` and no migration
    // step to stand in for it (tech-stack §4.4).
    await app.init();
    dataSource = moduleRef.get(DataSource);
    patients = dataSource.getRepository(LegacyPatient);
    rules = dataSource.getRepository(Rule);
    versions = dataSource.getRepository(RuleVersion);
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
    await dataSource.query(`DELETE FROM legacy_intake_rule`);
    await dataSource.query(`DELETE FROM legacy_consent_rule`);
    await dataSource.query(`DELETE FROM rule_version`);
    await dataSource.query(`DELETE FROM rule`);
    await dataSource.query(`DELETE FROM legacy_patient`);
    await patients.insert(fixedPatients());
  });

  it('posts the press to /rules/apply and sends no body at all (1.2.10)', async () => {
    await seedRule('R-BTN-PRESS');

    // The button's whole press: no arguments, because the endpoint takes no
    // input and nothing on the screen decides which rules run.
    await applyRules();

    expect(lastSent()).toEqual({ method: 'POST', path: '/rules/apply', body: undefined });
  });

  it('runs the active versions over the data and writes what they found', async () => {
    await seedRule('R-BTN-RUN');

    const report = await applyRules();

    // One press, both halves: the runner called the rule (1.2.10) and the
    // persistence layer wrote what it found (1.1.3). A route that answered 200
    // without doing either would pass a call count and fail this.
    expect(report.rules).toEqual([
      { ruleId: 'R-BTN-RUN', version: 1, found: 2, declined: 0, repeated: 0, written: 2 },
    ]);
    expect(report.totals).toEqual({
      versionsRun: 1,
      found: 2,
      declined: 0,
      repeated: 0,
      written: 2,
    });

    // Every stored value came from a real row the rule read, and every row is
    // pending: a run decides nothing, which is why the button needs no
    // confirmation step.
    expect(await storedRows('legacy_patient_rule')).toEqual([
      {
        legacy_id: 'P-1',
        rule_id: 'R-BTN-RUN',
        version: 1,
        column: 'phone',
        previous_value: '0612345678',
        next_value: '+31612345678',
        status: 'pending',
        reason: null,
      },
      {
        legacy_id: 'P-3',
        rule_id: 'R-BTN-RUN',
        version: 1,
        column: 'phone',
        previous_value: '0698765432',
        next_value: '+31698765432',
        status: 'pending',
        reason: null,
      },
    ]);
  });

  it('refreshes the screen from the results of the run it just made (1.2.10)', async () => {
    await seedRule('R-BTN-LIST');

    // Before the press the rule has an active version and no findings, so it is
    // not on the screen at all (1.2.1).
    expect(await getRules()).toEqual([]);

    await applyRules();

    // The refresh: the same list client the screen re-reads with, and it now
    // reports the rows the press produced. Press without refreshing and the
    // screen would still show the empty list above.
    expect(await getRules()).toEqual([
      {
        ruleId: 'R-BTN-LIST',
        ruleName: 'R-BTN-LIST name',
        version: 1,
        pending: 2,
        ambiguous: false,
      },
    ]);

    // And the refresh really is a second request, to the list's own address,
    // rather than state written out of the press's report body.
    expect(sent.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /rules',
      'POST /rules/apply',
      'GET /rules',
    ]);
  });

  it('answers a report carrying exactly the fields, and the types, the screen declares', async () => {
    await seedRule('R-BTN-SHAPE');

    // The value the client returns is the response body it parsed, so these are
    // the keys the run summary line reads.
    const report = await applyRules();
    const types = readFileSync(typesFile, 'utf8');

    // The report itself by name: its two fields are a nested object and an
    // array, so `typeof` says `object` for both and comparing types would prove
    // nothing. The two interfaces below are where the numbers are.
    expect(Object.keys(report).sort()).toEqual(
      Object.keys(declaredFields(types, typesFile, 'ApplyRulesReport')).sort(),
    );
    expect(Array.isArray(report.rules)).toBe(true);

    // Name for name and type for type on the totals the summary line is built
    // from, and on one line of the run. Rename, retype, add or drop a field on
    // either side and this fails with both spellings printed, rather than the
    // summary line rendering `undefined`.
    expect(declaredFields(types, typesFile, 'ApplyRulesTotals')).toEqual(wireFields(report.totals));
    expect(declaredFields(types, typesFile, 'ApplyRulesRuleLine')).toEqual(
      wireFields(report.rules[0]),
    );
  });

  it('rejects with the failure the screen shows, having written nothing (1.2.10)', async () => {
    // An active version whose code a deploy lost: the run aborts, and the
    // button's failure branch has a real failure to show.
    await seedRule('R-BTN-BROKEN');

    const failure: unknown = await applyRules().then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(ApiError);

    const error = failure as ApiError;

    // Status and URL are what the alert prints. Both come from the client, so a
    // press that swallowed the failure or lost the address fails here.
    expect(error.status).toBe(500);
    expect(error.url.endsWith('/rules/apply')).toBe(true);

    // And not one row was written, so the screen refreshing off this press
    // would be refreshing off a run that did not happen.
    expect(await ruleRowCounts()).toEqual([0, 0, 0]);
  });

  it('is the press the screen actually makes: the button calls the client, not fetch', async () => {
    const page = readFileSync(rulesPageFile, 'utf8');

    // With frontend tests cut (deferred D1) this is the only link between the
    // press this suite exercises and the button on the screen. A page that
    // built its own request would be unreachable from here — and untested.
    expect(page).toMatch(/import \{[^}]*\bapplyRules\b[^}]*\} from '\.\.\/api\/client';/);
    expect(page).not.toContain('fetch(');
  });
});
