import { existsSync, readFileSync } from 'node:fs';
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
 * The agreement between `.claude/workflows/rule-effects.js` and the repository
 * it reads (1.5.3), held by reading the script as text — `workflow-script.ts`
 * says why.
 *
 * Beyond the commands and files every workflow names, this one names two routes
 * of the running API, and the revision workflow names it.
 */
const workflow = () => readWorkflow('rule-effects');

/** An API source file, which is where a controller's routes are spelt. */
function apiSource(...path: string[]): string {
  return readFileSync(join(root, 'apps', 'api', 'src', ...path), 'utf8');
}

describe('the rule-effects workflow’s contract with the repository', () => {
  it('exists, and declares a literal meta naming itself and its phases', () => {
    const block = metaBlock(workflow());

    expect(block).toContain("name: 'rule-effects'");
    expect(block).not.toMatch(/name:\s*[`$]/);
    expect(declaredPhases(workflow()).length).toBeGreaterThan(0);
  });

  it('calls exactly the phases it declares, title for title', () => {
    expect(calledPhases(workflow()).slice().sort()).toEqual(
      declaredPhases(workflow()).slice().sort(),
    );
  });

  it('names only commands the repository actually has', () => {
    const recipes = declaredRecipes();
    const commanded = commandedRecipes(workflow());

    // The command is how it measures when no API is running — after the
    // revision workflow rebuilt it, for one.
    expect(commanded).toContain('rule-effects');
    expect(commanded.filter((recipe) => !recipes.includes(recipe))).toEqual([]);
  });

  it('rides on a recipe that prints only JSON, running a command that exists in the source', () => {
    // --silent keeps npm's banner out of the file the agent saves and parses.
    expect(recipeCommand('rule-effects')).toContain('npm run --silent rule-effects -w apps/api');

    const source = compiledSource('rule-effects');

    expect({ source, exists: existsSync(source) }).toEqual({ source, exists: true });
  });

  it('asks the running API only for routes it serves', () => {
    const { source } = workflow();
    const effects = apiSource('rule-effects', 'rule-effects.controller.ts');

    expect(source).toContain('/rules/<id>/effects');
    expect(effects).toContain("@Controller('rules')");
    expect(effects).toContain("@Get(':ruleId/effects')");

    expect(source).toContain('/health');
    expect(apiSource('health', 'health.controller.ts')).toContain("@Controller('health')");
  });

  it('points its agents at files that exist, the rule catalogue included', () => {
    const paths = namedPaths(workflow());

    expect(paths).toContain('apps/api/src/rules/catalogue');
    expect(paths.filter((path) => !existsSync(join(root, path)))).toEqual([]);
  });

  it('is run by the revision workflow, on the rules it revises', () => {
    expect(readWorkflow('revise').source).toContain("workflow('rule-effects', changedRules)");
  });
});
