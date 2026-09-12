import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createRuleContext } from './rule-context';
import type { RuleResponse } from './rule-contract';
import { RuleRegistry } from './rule-registry';
import { RuleVersion } from './rule-version.entity';

/**
 * What one rule version returned, tagged with the key that produced it.
 *
 * The response is nested exactly as the rule handed it over, not flattened or
 * re-shaped: this is the runner's half of the contract with the persistence
 * layer (1.1.3), and that layer needs both the finding and the
 * `(ruleId, version)` it belongs to, because the modification log records which
 * rule at which version changed a column (1.3).
 *
 * These types live here rather than in `rule-contract.ts`, which is the
 * contract between the runner and rule code. This is the contract between the
 * runner and whatever consumes a run.
 */
export interface RuleRunEntry {
  ruleId: string;
  /** Integer, matching `rule_version.version`. */
  version: number;
  response: RuleResponse;
}

/** One entry per active rule version, in the order they were called. */
export type RuleRunResult = RuleRunEntry[];

/**
 * The runner: every active rule version, called once, over the whole dataset.
 *
 * This is what "Apply rules" walks (1.2.10). It knows nothing about any
 * individual rule (1.1.14) — it reads `rule_version`, asks the registry for the
 * code behind each active key, calls it, and keeps what came back. There is no
 * branching on which rule it is, no inspection of an update, and no per-row
 * work of any kind: a rule that finds 340 rows is still exactly one call
 * (1.1.14).
 *
 * It also gates nothing. A version that is active runs on the next press of
 * Apply rules with no prior approval (1.1.11), and a rule that matched nothing
 * still gets an entry — being invisible in the UI is a decision the rules
 * screen makes from pending rows (1.2.1), not one the runner makes by dropping
 * an empty response.
 *
 * Three choices worth stating, because none of them is obvious from the code:
 *
 * - **No transaction.** Rules read the modified data, not a frozen snapshot
 *   (1.2.10), and a transaction would be both a snapshot and a write path. One
 *   `RuleContext` is built from the plain manager and handed to every rule; it
 *   has no way to write (1.1.2), and this service writes nothing either —
 *   turning a response into rule rows belongs elsewhere (1.1.3).
 * - **The active set is read once, up front, in one query.** A version
 *   activated while a run is in flight belongs to the next press of Apply
 *   rules, not to this one.
 * - **A failure aborts the run.** An active version the registry has no code
 *   for throws `UnregisteredRuleError`, and a rule that throws throws. Nothing
 *   is caught, collected or skipped: a deploy that lost a rule's code would
 *   otherwise produce a findings set that looks complete and is not.
 *
 * Rules are called sequentially in ascending `(ruleId, version)` order. There
 * is one SQLite connection, so parallelism buys nothing, and rules interacting
 * with one another is out of scope (`deferred.md` D3), so the order carries no
 * meaning beyond making a run reproducible.
 */
@Injectable()
export class RuleRunnerService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly registry: RuleRegistry,
  ) {}

  /**
   * Runs every active rule version against the entire dataset and returns what
   * each one found (1.2.10).
   */
  async run(): Promise<RuleRunResult> {
    const activeVersions = await this.dataSource.getRepository(RuleVersion).find({
      where: { status: 'active' },
      order: { ruleId: 'ASC', version: 'ASC' },
    });

    const context = createRuleContext(this.dataSource.manager);
    const result: RuleRunResult = [];

    for (const { ruleId, version } of activeVersions) {
      const response = await this.registry.run(ruleId, version, context);

      result.push({ ruleId, version, response });
    }

    return result;
  }
}
