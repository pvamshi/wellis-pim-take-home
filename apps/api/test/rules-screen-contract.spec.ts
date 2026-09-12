import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatientRule } from '../src/legacy/legacy-rule.entity';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import type { RulesListResponse } from '../src/rules-list/rules-list.controller';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * The agreement between `GET /rules` and the rules screen that reads it
 * (1.2.1).
 *
 * The screen is a separate workspace with no test runner of its own — frontend
 * tests are a stated cut (tech-stack §4.7, deferred D1) — and the workspaces
 * are `apps/*` only, so there is no shared package for the two sides to import
 * one interface from. `apps/web/src/api/types.ts` therefore restates this
 * endpoint's `RuleListEntry` by hand, and a restatement is a copy that can
 * silently stop being true: rename `pending` here, and every build, lint and
 * test in the repository still passes while the screen renders `undefined`.
 *
 * This suite is what holds the copy to the original. It reads the web app's
 * declaration as text — type annotations are erased before anything runs, so
 * the source file is the only place the screen's expectation exists — and
 * compares it against a real response from a real database. It fails if either
 * side moves without the other: a renamed or retyped field, a field added or
 * dropped, a body that stops being a bare array, or a route that stops being
 * the one the client builds.
 *
 * It belongs to the api rather than to the web app because this is where tests
 * run, and because the api is the side that owns the contract: when the two
 * disagree, the backend is right and the copy is the bug.
 */

/**
 * The web app sits beside this one while the suite runs from `apps/api`.
 * Walking up finds the repository root from either, so the spec does not
 * hard-code how it was launched.
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

const webApiDirectory = findWebApiDirectory();
const typesFile = join(webApiDirectory, 'types.ts');
const clientFile = join(webApiDirectory, 'client.ts');

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
 * `readonly` is dropped because it says nothing about the wire, but an
 * optional marker is kept on the name: a field the screen has made optional is
 * no longer the same expectation as the one the endpoint always sends, and
 * this comparison should say so rather than quietly accept it.
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
function wireFields(entry: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const [name, value] of Object.entries(entry)) {
    fields[name] = typeof value;
  }

  return fields;
}

describe('the rules screen’s contract with GET /rules', () => {
  let app: INestApplication;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    // Booting is what creates the tables: `synchronize: true` and no migration
    // step to stand in for it (tech-stack §4.4).
    await app.init();

    const dataSource = moduleRef.get(DataSource);

    // One rule with one pending row, seeded straight through the repositories:
    // the shape of a line is the same whatever ran to produce it, and this
    // suite is about the shape rather than about the join (rules-list.spec.ts
    // owns that). A line is needed at all because an empty list carries no
    // fields to compare.
    await dataSource.getRepository(Rule).save({
      ruleId: 'R-CONTRACT',
      ruleName: 'R-CONTRACT name',
      description: 'R-CONTRACT description',
      ambiguous: false,
    });
    await dataSource.getRepository(RuleVersion).insert({ ruleId: 'R-CONTRACT', version: 1 });
    await moduleRef.get(RuleVersionsService).activate('R-CONTRACT', 1);
    await dataSource.getRepository(LegacyPatientRule).insert({
      legacyId: 'R-CONTRACT-1',
      ruleId: 'R-CONTRACT',
      version: 1,
      column: 'phone',
      previousValue: '0612345678',
      nextValue: '+31612345678',
      status: 'pending',
      reason: null,
    });
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

  it('answers with exactly the fields, and the types, the screen declares it reads', async () => {
    const response = await request(app.getHttpServer()).get('/rules');
    const body = response.body as RulesListResponse;

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);

    // Name for name and type for type. `RuleListEntry` in apps/api is the
    // source of truth; apps/web restates it; this is the only thing in the
    // repository that notices when the restatement stops matching. Rename
    // `pending` to `pendingCount` on either side and this assertion fails with
    // both spellings printed.
    expect(declaredFields(readFileSync(typesFile, 'utf8'), typesFile, 'RuleListEntry')).toEqual(
      wireFields(body[0] as unknown as Record<string, unknown>),
    );
  });

  it('answers a bare array, which is what the screen iterates', async () => {
    const response = await request(app.getHttpServer()).get('/rules');

    // The endpoint deliberately does not wrap the list in `{ rules: [...] }`,
    // and the screen maps over the body directly. Wrapping it later would
    // render nothing at all rather than fail.
    expect(Array.isArray(response.body)).toBe(true);
    expect(readFileSync(typesFile, 'utf8')).toContain(
      'export type RulesListResponse = RuleListEntry[]',
    );
  });

  it('serves the path the screen’s client builds', async () => {
    const client = readFileSync(clientFile, 'utf8');
    const built = /export const rulesUrl = `\$\{apiBaseUrl\}([^`]*)`/.exec(client);

    if (built === null) {
      throw new Error(`${clientFile} no longer builds \`rulesUrl\` from \`apiBaseUrl\``);
    }

    // The path is the other half of the copy: the client writes it out as a
    // string, and a controller that moved would leave the screen calling an
    // address nothing answers on.
    const response = await request(app.getHttpServer()).get(built[1]);

    expect({ path: built[1], status: response.status }).toEqual({ path: '/rules', status: 200 });
  });
});
