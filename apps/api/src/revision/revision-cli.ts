import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import {
  RuleRevisionsService,
  type NewRuleRequest,
  type NewRuleVersionRequest,
  type RevisionRequest,
} from '../rules/rule-revisions.service';

const USAGE = 'usage: just revise queue | just revise apply <file.json>';

/**
 * Reads an optional `activate` flag. Absent means true — a new version and a
 * new rule are activated unless the revision says otherwise, so the ordinary
 * case (1.5.1) needs no flag and only the parked case (1.5.2) says anything.
 */
function readActivate(value: unknown, where: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${where}.activate must be true or false`);
  }

  return value;
}

function readInteger(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${where} must be an integer`);
  }

  return value;
}

function readText(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${where} must be a non-empty string`);
  }

  return value;
}

function readObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }

  return value as Record<string, unknown>;
}

function readNewVersion(value: unknown): NewRuleVersionRequest {
  const { version, activate } = readObject(value, 'newVersion');

  return {
    version: readInteger(version, 'newVersion.version'),
    activate: readActivate(activate, 'newVersion'),
  };
}

function readNewRule(value: unknown): NewRuleRequest {
  const { ruleId, ruleName, description, ambiguous, activate } = readObject(value, 'newRule');

  if (typeof ambiguous !== 'boolean') {
    throw new Error('newRule.ambiguous must be true or false');
  }

  return {
    ruleId: readText(ruleId, 'newRule.ruleId'),
    ruleName: readText(ruleName, 'newRule.ruleName'),
    description: readText(description, 'newRule.description'),
    ambiguous,
    activate: readActivate(activate, 'newRule'),
  };
}

/**
 * Reads a revision request out of the parsed file, or says what is wrong with
 * it.
 *
 * By hand, and field by field, for the reason the controllers give: the stack
 * (tech-stack §4.4, §4.7) names no validation library, and this is JSON that
 * crossed a boundary — every lookup has to be able to miss. What is checked
 * here is only the shape. Whether the version is queued, whether the number is
 * above the rule's highest, and whether the registry has code for it are the
 * service's answers, not this file's.
 */
function readRevisionRequest(value: unknown): RevisionRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      'the revision file must hold an object of { ruleId, version, newVersion?, newRule? }',
    );
  }

  const { ruleId, version, newVersion, newRule } = value as Record<string, unknown>;

  return {
    ruleId: readText(ruleId, 'ruleId'),
    version: readInteger(version, 'version'),
    newVersion: newVersion === undefined ? undefined : readNewVersion(newVersion),
    newRule: newRule === undefined ? undefined : readNewRule(newRule),
  };
}

/** The request as a file, because it may carry a whole new rule (1.5.2). */
function readRequestFile(path: string | undefined): RevisionRequest {
  if (path === undefined) {
    throw new Error(`apply needs the path of a revision file. ${USAGE}`);
  }

  const resolved = resolve(path);
  const text = readFileSync(resolved, 'utf8');

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${resolved} is not valid JSON: ${(error as Error).message}`);
  }

  return readRevisionRequest(parsed);
}

/**
 * The revision workflow's hands on the database (1.5.1).
 *
 * A command rather than an endpoint, following the import: this is a batch
 * operation run from a terminal with no screen behind it, and an endpoint would
 * make the workflow depend on a running server. It boots the application
 * context rather than opening a connection of its own, so `DATABASE_URL` alone
 * chooses the database, exactly as it does for the api (tech-stack 4.6.1).
 *
 * Two subcommands, which are the two halves of a revision:
 *
 * - `queue` prints every version waiting to be revised, as JSON, so the agent
 *   reading it gets the reason, the rule, and the version number its new code
 *   must be registered under.
 * - `apply <file.json>` applies one revision. A file rather than flags, because
 *   a revision may carry a whole new rule alongside the new version (1.5.2) and
 *   that would mangle as flags through `just` and `npm`.
 *
 * The service is the revision; this only decides which of the two to call and
 * prints what comes back.
 */
async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);

  if (command !== 'queue' && command !== 'apply') {
    console.error(command === undefined ? USAGE : `unknown command "${command}". ${USAGE}`);
    process.exitCode = 1;
    return;
  }

  // Read and check the request before booting anything: a malformed file is a
  // cheap failure and there is no reason to open a database to report it.
  const request = command === 'apply' ? readRequestFile(argument) : null;

  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const revisions = context.get(RuleRevisionsService);
    const result = request === null ? await revisions.queue() : await revisions.revise(request);

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
