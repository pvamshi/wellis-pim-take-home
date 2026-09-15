import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * A `.claude/workflows/*.js` script read as text, for the suites that hold a
 * workflow to its agreement with the repository it drives.
 *
 * A workflow script runs under the workflow runner, which injects `agent`,
 * `phase`, `log`, `workflow` and `args`, so it is not a module a suite can
 * import and run — and it has no test runner of its own. What it does have is a
 * set of names it depends on: the commands it tells its agents to run, the
 * files it points them at, and the phase titles its progress display is drawn
 * from. Every one of those is a string, and a string goes stale silently:
 * rename a recipe in the justfile and every build, lint and test in the
 * repository still passes while the workflow calls something that no longer
 * exists.
 *
 * It lives here for the reason `rules-screen-contract.spec.ts` does: this is
 * where tests run.
 */

/**
 * The repository root, found from wherever the suite was launched — `apps/api`
 * when vitest runs it, the root when something else does.
 */
function findRepositoryRoot(): string {
  let directory = process.cwd();

  for (;;) {
    if (existsSync(join(directory, '.claude', 'workflows'))) {
      return directory;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      throw new Error(`.claude/workflows was not found at or above ${process.cwd()}`);
    }

    directory = parent;
  }
}

export const root = findRepositoryRoot();
const justfile = join(root, 'justfile');
const apiPackageFile = join(root, 'apps', 'api', 'package.json');

export interface WorkflowScript {
  readonly file: string;
  readonly source: string;
}

/** The script as text. Reading it is the only way to read it — see above. */
export function readWorkflow(name: string): WorkflowScript {
  const file = join(root, '.claude', 'workflows', `${name}.js`);

  if (!existsSync(file)) {
    throw new Error(`${file} does not exist, so there is no ${name} workflow`);
  }

  return { file, source: readFileSync(file, 'utf8') };
}

/**
 * The body of `export const meta = { … }`, which the runner requires to be a
 * pure literal: no variables, no calls, no interpolation. Read from the text
 * rather than imported, because importing would execute the script body.
 */
export function metaBlock({ file, source }: WorkflowScript): string {
  const header = 'export const meta = {';
  const start = source.indexOf(header);

  if (start === -1) {
    throw new Error(`${file} no longer declares \`${header}\``);
  }

  const end = source.indexOf('\n}', start);

  if (end === -1) {
    throw new Error(`\`${header}\` in ${file} is never closed`);
  }

  return source.slice(start + header.length, end);
}

/** Every `title: '…'` the meta literal declares, in order. */
export function declaredPhases(script: WorkflowScript): string[] {
  return [...metaBlock(script).matchAll(/title:\s*'([^']+)'/g)].map((match) => match[1]);
}

/**
 * Every phase the script body uses, de-duplicated, in order: a `phase('…')`
 * call, or an agent's `phase: '…'` option — which is how agents running side by
 * side in one pipeline keep to their own groups.
 */
export function calledPhases({ source }: WorkflowScript): string[] {
  const called = [
    ...source.matchAll(/(?:^|[^A-Za-z0-9_.])phase(?:\('([^']+)'\)|:\s*'([^']+)')/gm),
  ].map((match) => match[1] ?? match[2]);

  return [...new Set(called)];
}

/** Every `just <recipe>` the script tells an agent to run, de-duplicated. */
export function commandedRecipes({ source }: WorkflowScript): string[] {
  return [...new Set([...source.matchAll(/just ([a-z][a-z0-9-]*)/g)].map((match) => match[1]))];
}

/** Every recipe the justfile declares. */
export function declaredRecipes(): string[] {
  return [...readFileSync(justfile, 'utf8').matchAll(/^([a-z][a-z0-9-]*)(?: \*[A-Z]+)?:/gm)].map(
    (match) => match[1],
  );
}

/** Every repository path the script names as a string literal. */
export function namedPaths({ source }: WorkflowScript): string[] {
  return [
    ...new Set(
      [...source.matchAll(/'((?:apps|notes)\/[A-Za-z0-9_\-./]+)'/g)].map((match) => match[1]),
    ),
  ];
}

/** The line a `<name> *ARGS:` recipe runs. */
export function recipeCommand(name: string): string {
  const recipe = new RegExp(`^${name} \\*ARGS:\\n\\s+(.+)$`, 'm').exec(
    readFileSync(justfile, 'utf8'),
  );

  if (recipe === null) {
    throw new Error(`${justfile} no longer declares a \`${name} *ARGS:\` recipe`);
  }

  return recipe[1];
}

/**
 * The source file an `apps/api` package script runs. The script runs what
 * `nest build` emits, so the proof that the command exists is that its source
 * does: dist/x/y.js is src/x/y.ts and nothing else.
 */
export function compiledSource(scriptName: string): string {
  const scripts = (
    JSON.parse(readFileSync(apiPackageFile, 'utf8')) as { scripts: Record<string, string> }
  ).scripts;
  const compiled = /node (dist\/[A-Za-z0-9_\-./]+)\.js/.exec(scripts[scriptName] ?? '');

  if (compiled === null) {
    throw new Error(`${apiPackageFile} has no \`${scriptName}\` script running a compiled file`);
  }

  return join(root, 'apps', 'api', compiled[1].replace(/^dist/, 'src') + '.ts');
}
