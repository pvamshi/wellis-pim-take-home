import type { EntityManager, EntityTarget, FindManyOptions, ObjectLiteral } from 'typeorm';
import type { RuleContext } from './rule-contract';

/**
 * Builds the object a rule is handed.
 *
 * Two methods, and the surface is deliberately no wider. A rule reads and runs
 * queries (1.1.2) across rows and across tables (1.1.6), so it needs `find` for
 * whole tables and `query` for the questions that span two of them. It needs
 * nothing else, and every method it does not have is a way it cannot write.
 *
 * Read-only is structural here, not policed. Nothing sniffs the SQL for write
 * keywords: a keyword check gives false confidence, trips over the word
 * `update` inside a string literal, and cannot see through a CTE. Rule code is
 * ours, in git and reviewed (1.1.1), so the honest guard is giving it nothing
 * to write with.
 *
 * The manager is closed over and never exposed as a property, so a rule cannot
 * reach `context.manager.save(...)` round the back. An `EntityManager` rather
 * than a `DataSource` because a later caller can then hand in a transactional
 * manager without the contract changing.
 */
export function createRuleContext(manager: EntityManager): RuleContext {
  return Object.freeze({
    find<Entity extends ObjectLiteral>(
      entity: EntityTarget<Entity>,
      options?: FindManyOptions<Entity>,
    ): Promise<Entity[]> {
      return manager.find(entity, options);
    },

    query<Row = unknown>(sql: string, parameters?: unknown[]): Promise<Row[]> {
      return manager.query<Row[]>(sql, parameters);
    },
  });
}
