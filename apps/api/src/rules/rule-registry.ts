import type { RegisteredRule, RuleContext, RuleFunction, RuleResponse } from './rule-contract';

/**
 * Thrown when no code is registered for a `(ruleId, version)`.
 *
 * Deliberately not named like `UnknownRuleVersionError`, which is about a
 * missing `rule_version` row: a row with no code and code with no row are
 * different failures, and reading one message as the other sends whoever is
 * debugging to the wrong place.
 */
export class UnregisteredRuleError extends Error {
  constructor(
    readonly ruleId: string,
    readonly version: number,
  ) {
    super(`no rule code is registered for ${ruleId} version ${version}`);
    this.name = 'UnregisteredRuleError';
  }
}

/** Thrown when a rule's response breaks the one invariant 1.1.14 states. */
export class InvalidRuleResponseError extends Error {
  constructor(
    readonly ruleId: string,
    readonly version: number,
    message: string,
  ) {
    super(`rule ${ruleId} version ${version} returned an invalid response: ${message}`);
    this.name = 'InvalidRuleResponseError';
  }
}

/** The one key both the database and the codebase address a rule by (1.1.1). */
function keyOf(ruleId: string, version: number): string {
  return `${ruleId}@${version}`;
}

/**
 * The map from `(ruleId, version)` to the function that implements it.
 *
 * This is the whole of how the runner gets from a `rule_version` row saying
 * `(R7, 2)` to code (1.1.1). The runner injects this and knows nothing about
 * any individual rule (1.1.14).
 *
 * A plain class, not an `@Injectable()` with constructor injection, so it can
 * be built with fake entries in a test with no Nest container. `RulesModule`
 * provides it from the catalogue.
 */
export class RuleRegistry {
  private readonly rules = new Map<string, RuleFunction>();

  /**
   * Every entry registers, and a key registering twice throws rather than the
   * second entry quietly shadowing the first — a rule silently running code
   * other than the code its key names is the failure this class exists to make
   * impossible.
   */
  constructor(catalogue: readonly RegisteredRule[]) {
    for (const rule of catalogue) {
      const key = keyOf(rule.ruleId, rule.version);

      if (this.rules.has(key)) {
        throw new Error(`rule ${rule.ruleId} version ${rule.version} is already registered`);
      }

      this.rules.set(key, rule.run);
    }
  }

  /**
   * The code for exactly this version. Never a nearest or latest version: the
   * version is half the key (1.1.1), and a finding recorded under a version
   * whose code did not produce it misattributes the change the modification log
   * points at (1.3).
   */
  get(ruleId: string, version: number): RuleFunction {
    const run = this.rules.get(keyOf(ruleId, version));

    if (run === undefined) {
      throw new UnregisteredRuleError(ruleId, version);
    }

    return run;
  }

  /** Every version registered for a rule, lowest first; empty when the rule has no code. */
  versionsOf(ruleId: string): number[] {
    const versions: number[] = [];

    for (const key of this.rules.keys()) {
      const at = key.lastIndexOf('@');
      if (key.slice(0, at) === ruleId) versions.push(Number(key.slice(at + 1)));
    }

    return versions.sort((left, right) => left - right);
  }

  /**
   * Resolves the code, calls it once, and hands back what it returned.
   *
   * Once, not once per row (1.1.14) — everything the rule found comes back in
   * the one response.
   *
   * The only thing checked is the one invariant the requirement states in
   * words: when `ambiguity` is true, every update carries a `prev` and no
   * `next`. Nothing else is validated. Table and column names are the type's
   * job, and a guard no requirement asks for would be this layer inventing
   * policy for rules it is supposed to know nothing about.
   */
  async run(ruleId: string, version: number, context: RuleContext): Promise<RuleResponse> {
    const response = await this.get(ruleId, version)(context);

    if (response.ambiguity && response.updates.some((update) => update.next !== null)) {
      throw new InvalidRuleResponseError(
        ruleId,
        version,
        'ambiguity is true, so every update must carry a null next',
      );
    }

    return response;
  }
}
