import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  calledPhases,
  commandedRecipes,
  compiledSource,
  declaredPhases,
  declaredRecipes,
  metaBlock,
  namedPaths,
  readWorkflow,
  recipeCommand,
  root,
} from './workflow-script';

/**
 * The agreement between `.claude/workflows/revise.js` and the repository it
 * drives (1.5.1).
 *
 * The workflow script is the revision workflow: it is what reads the queue,
 * writes the next version and applies it. This suite holds it to the names it
 * depends on by reading it as text — `workflow-script.ts` says why that is the
 * only way.
 */
const workflow = () => readWorkflow('revise');

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
    expect(recipeCommand('revise')).toContain('npm run revise -w apps/api');

    // dist/revision/revision-cli.js is src/revision/revision-cli.ts.
    const source = compiledSource('revise');

    expect({ source, exists: existsSync(source) }).toEqual({ source, exists: true });
  });

  it('names both subcommands the revision needs', () => {
    const { source } = workflow();

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
