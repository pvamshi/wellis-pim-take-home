import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The agreement between `.claude/workflows/revise.js` and the repository it
 * drives (1.5.1).
 *
 * The workflow script is the revision workflow: it is what reads the queue,
 * writes the next version and applies it. It runs under the workflow runner,
 * which injects `agent`, `phase`, `log` and `args`, so it is not a module this
 * suite can import and run — and it has no test runner of its own. What it
 * does have is a set of names it depends on: the commands it tells its agents
 * to run, the file it tells them to register rule code in, and the phase titles
 * its progress display is drawn from. Every one of those is a string, and a
 * string goes stale silently: rename the `revise` recipe in the justfile and
 * every build, lint and test in the repository still passes while the workflow
 * calls something that no longer exists.
 *
 * This suite holds the script to those names, by reading it as text. It is the
 * same thing `rules-screen-contract.spec.ts` does for the copy of an endpoint's
 * type in the web app, and it lives here for the same reason: this is where
 * tests run.
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

const root = findRepositoryRoot();
const workflowFile = join(root, '.claude', 'workflows', 'revise.js');
const justfile = join(root, 'justfile');
const apiPackageFile = join(root, 'apps', 'api', 'package.json');

/** The script as text. Reading it is the only way to read it — see above. */
function workflow(): string {
  if (!existsSync(workflowFile)) {
    throw new Error(`${workflowFile} does not exist, so there is no revision workflow`);
  }

  return readFileSync(workflowFile, 'utf8');
}

/**
 * The body of `export const meta = { … }`, which the runner requires to be a
 * pure literal: no variables, no calls, no interpolation. Read from the text
 * rather than imported, because importing would execute the script body.
 */
function metaBlock(source: string): string {
  const header = 'export const meta = {';
  const start = source.indexOf(header);

  if (start === -1) {
    throw new Error(`${workflowFile} no longer declares \`${header}\``);
  }

  const end = source.indexOf('\n}', start);

  if (end === -1) {
    throw new Error(`\`${header}\` in ${workflowFile} is never closed`);
  }

  return source.slice(start + header.length, end);
}

/** Every `title: '…'` the meta literal declares, in order. */
function declaredPhases(source: string): string[] {
  return [...metaBlock(source).matchAll(/title:\s*'([^']+)'/g)].map((match) => match[1]);
}

/** Every `phase('…')` the script body calls, de-duplicated, in order. */
function calledPhases(source: string): string[] {
  const called = [...source.matchAll(/(?:^|[^A-Za-z0-9_.])phase\('([^']+)'\)/gm)].map(
    (match) => match[1],
  );

  return [...new Set(called)];
}

/** Every `just <recipe>` the script tells an agent to run, de-duplicated. */
function commandedRecipes(source: string): string[] {
  return [...new Set([...source.matchAll(/just ([a-z][a-z0-9-]*)/g)].map((match) => match[1]))];
}

/** Every recipe the justfile declares. */
function declaredRecipes(): string[] {
  return [...readFileSync(justfile, 'utf8').matchAll(/^([a-z][a-z0-9-]*)(?: \*[A-Z]+)?:/gm)].map(
    (match) => match[1],
  );
}

/** Every repository path the script names as a string literal. */
function namedPaths(source: string): string[] {
  return [
    ...new Set(
      [...source.matchAll(/'((?:apps|notes)\/[A-Za-z0-9_\-./]+)'/g)].map((match) => match[1]),
    ),
  ];
}

describe('the revision workflow’s contract with the repository', () => {
  it('exists, and declares a literal meta naming itself and its phases', () => {
    const block = metaBlock(workflow());

    // The runner lists a workflow by its meta, and requires it to be a pure
    // literal: a name built from a variable would leave the workflow
    // unlistable, which is a failure with no other symptom.
    expect(block).toContain("name: 'revise'");
    expect(block).not.toMatch(/name:\s*[`$]/);
    expect(declaredPhases(workflow()).length).toBeGreaterThan(0);
  });

  it('calls exactly the phases it declares, title for title', () => {
    // The runner matches these two by exact string. A rename on one side alone
    // silently splits the progress display into two groups, and nothing else in
    // the repository would notice.
    expect(calledPhases(workflow()).slice().sort()).toEqual(
      declaredPhases(workflow()).slice().sort(),
    );
  });

  it('names only commands the repository actually has', () => {
    const recipes = declaredRecipes();
    const commanded = commandedRecipes(workflow());

    // Every 'just …' in the script, including the two the revision itself rides
    // on and the build and test it must pass before applying anything.
    expect(commanded).toContain('revise');
    expect(commanded.filter((recipe) => !recipes.includes(recipe))).toEqual([]);
  });

  it('rides on a recipe that runs a command that exists in the source', () => {
    const recipe = /^revise \*ARGS:\n\s+(.+)$/m.exec(readFileSync(justfile, 'utf8'));

    if (recipe === null) {
      throw new Error(`${justfile} no longer declares a \`revise *ARGS:\` recipe`);
    }

    expect(recipe[1]).toContain('npm run revise -w apps/api');

    const scripts = (
      JSON.parse(readFileSync(apiPackageFile, 'utf8')) as { scripts: Record<string, string> }
    ).scripts;
    const compiled = /node (dist\/[A-Za-z0-9_\-./]+)\.js/.exec(scripts.revise ?? '');

    if (compiled === null) {
      throw new Error(`${apiPackageFile} has no \`revise\` script running a compiled file`);
    }

    // The script runs what `nest build` emits, so the proof that the command
    // exists is that its source does: dist/revision/revision-cli.js is
    // src/revision/revision-cli.ts and nothing else.
    const source = join(root, 'apps', 'api', compiled[1].replace(/^dist/, 'src') + '.ts');

    expect({ source, exists: existsSync(source) }).toEqual({ source, exists: true });
  });

  it('names both subcommands the revision needs', () => {
    const source = workflow();

    // Reading the queue and applying one revision are the two halves of 1.5.1,
    // and the workflow is the only caller of either.
    expect(source).toContain('just revise queue');
    expect(source).toContain('just revise apply');
  });

  it('points its agents at files that exist, the rule catalogue included', () => {
    const paths = namedPaths(workflow());

    // Registering the new version's code is the step that makes
    // `(ruleId, version)` address code (1.1.1), so the file the script names
    // for it has to be the file that actually holds the catalogue.
    expect(paths).toContain('apps/api/src/rules/rule-catalogue.ts');
    expect(paths.filter((path) => !existsSync(join(root, path)))).toEqual([]);
  });
});
