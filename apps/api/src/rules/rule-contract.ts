import type { EntityTarget, FindManyOptions, ObjectLiteral } from 'typeorm';
import type { LegacySourceTable } from '../legacy/legacy-source-table';

/**
 * The contract between the runner and rule code. Types only — this file emits
 * no runtime, so importing it costs nothing and pulls in no wiring.
 */

/**
 * One proposed change to one column of one legacy row.
 *
 * This is 1.1.7's shape and there is no second one: a finding is always
 * `(table, row, column, previousValue, nextValue)`. A broken link between two
 * tables is a field holding the wrong value, so it arrives here like everything
 * else rather than through a shape of its own.
 *
 * Named `prev`/`next` because 1.1.14 prints them that way; the rule table calls
 * the same two values `previous_value` and `next_value`, and the layer that
 * persists a response (1.1.3) is where the two names meet.
 */
export interface RuleUpdate {
  /** Which legacy source the row is in. */
  table: LegacySourceTable;

  /**
   * The legacy id of the row, theirs and not ours. It names a row without
   * identifying one — two rows may share an id (1.0.3) — which is the same
   * thing `legacy_xxx_rule.legacy_id` already records.
   */
  legacyId: string;

  /** The column the rule tested, and so the column it changes (1.1.5). */
  column: string;

  /** What that column held when the rule ran. Null when it held nothing. */
  prev: string | null;

  /**
   * What the rule proposes instead. Null throughout when `ambiguity` is true
   * (1.1.12, 1.1.14) — an ambiguous rule found a problem it cannot fix, and the
   * rule's own description is what the human reads in place of a value.
   */
  next: string | null;
}

/**
 * Everything one rule found, in one response.
 *
 * A rule is called once, not once per row (1.1.14): it reads whole tables and
 * hands back every row that needs updating together. 340 rows in the wrong
 * phone format are 340 entries in `updates`, not 340 calls.
 *
 * `ambiguity` sits beside the updates rather than inside each one, because
 * 1.1.12 makes ambiguity a property of the rule and never of the row. One flag
 * for the whole response is what "rule-wide" means.
 */
export interface RuleResponse {
  /** True when this rule finds problems it cannot fix (1.1.12). */
  ambiguity: boolean;

  /** Every change found, in one batch (1.1.14). Empty when nothing matched. */
  updates: RuleUpdate[];
}

/**
 * What a rule is handed.
 *
 * Read access to the database and nothing else. A rule may read and run
 * queries (1.1.2) because its scope is wider than one value — one row, several
 * rows, or data spanning two tables (1.1.6) — so it gets the database rather
 * than a single value to inspect.
 *
 * There is no `save`, `insert`, `update`, `delete`, repository, manager or
 * DataSource here, and that is the point: "a rule writes nothing at all"
 * (1.1.2) is a property of what a rule is given, not a promise rule code makes.
 */
export interface RuleContext {
  /** Reads rows of one entity — the whole table when no options are given. */
  find<Entity extends ObjectLiteral>(
    entity: EntityTarget<Entity>,
    options?: FindManyOptions<Entity>,
  ): Promise<Entity[]>;

  /**
   * Runs a read query and returns its rows. This is what makes 1.1.6's
   * cross-table questions answerable in one pass instead of by loading two
   * tables and joining them in memory.
   */
  query<Row = unknown>(sql: string, parameters?: unknown[]): Promise<Row[]>;
}

/**
 * A rule: one function, called once, returning everything it found (1.1.14).
 *
 * Always async. One shape rather than "either a response or a promise of one",
 * so no caller has to decide which it got; a rule with nothing to await simply
 * declares itself `async`.
 */
export type RuleFunction = (context: RuleContext) => Promise<RuleResponse>;

/**
 * One entry in the catalogue: a `(ruleId, version)` key and the code written
 * against it (1.1.1). The version is part of the identity, not metadata on the
 * rule — a version change is new code under a new key, and the old code stays.
 */
export interface RegisteredRule {
  ruleId: string;
  /** Integer, matching `rule_version.version`. */
  version: number;
  run: RuleFunction;
}
