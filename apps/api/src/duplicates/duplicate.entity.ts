import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { LegacySourceTable } from '../legacy/legacy-source-table';

/**
 * Which legacy source the two ids belong to.
 *
 * The same three values name the tables in 1.1.14's `RuleResponse`, so they are
 * now written down once, in `legacy/legacy-source-table.ts`, and this is an
 * alias of that union. The name stays because this column's values are read as
 * a duplicate's source, not as a finding's table.
 */
export type DuplicateSourceTable = LegacySourceTable;

/**
 * A duplicate link, as the "Database structure — Duplicates" section describes
 * it.
 *
 * One table across all three legacy sources, kept apart so duplicate
 * information does not pollute every legacy row. It says one thing: id X is a
 * duplicate of id Y (1.1.13). It is not field-shaped and does not need to be —
 * writing this row changes no column of either legacy row.
 *
 * Two things it deliberately does not do:
 *
 * - It does not retire X. That waits on a status column legacy rows do not have
 *   — the `status` they do have is the export's own value, not a workflow state
 *   — and nothing reads this table to filter X out yet (`deferred.md` D5).
 * - It does not carry the values that move from X to Y. Anything that has to
 *   move is an ordinary rule row against Y with duplication as its reason
 *   (1.1.13), so merging reuses 1.1.7 and 1.2.5 and needs nothing here.
 *
 * No foreign keys, for the same two reasons the per-source rule tables carry
 * none: a legacy id names a row without identifying one, because two rows may
 * share it (1.0.3), and `(rule_id, version)` cannot go stale because versions
 * are never deleted (1.1.8).
 *
 * No uniqueness beyond the primary key, and no index. The structure gives this
 * row its own id and names no other key; whether a second press of Apply rules
 * records one link or two, and whether two legacy rows sharing id X produce one
 * link or two, are questions for whoever writes the duplicate rule and its write
 * path. Nothing reads this table yet, so an access path chosen here would be a
 * guess at a query nobody has written.
 */
@Entity('duplicate')
export class Duplicate {
  /**
   * Ours, and generated. The database-structure type gives this row an `id`
   * where it deliberately gave `LegacyPatientRule` none: a finding is addressed
   * by what it is about, but neither legacy id here is unique (1.0.3), so the
   * link has no natural key to be identified by.
   */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Which source both ids come from; one table serves all three. */
  @Column({ name: 'source_table', type: 'text' })
  sourceTable!: DuplicateSourceTable;

  /** X — the id that duplicates. */
  @Column({ name: 'duplicate_legacy_id', type: 'text' })
  duplicateLegacyId!: string;

  /** Y — the one that survives. */
  @Column({ name: 'canonical_legacy_id', type: 'text' })
  canonicalLegacyId!: string;

  /** The rule that found the link, and the version of it that ran. */
  @Column({ name: 'rule_id', type: 'text' })
  ruleId!: string;

  /**
   * Integer, matching `rule_version.version`. The legacy tables' text-only rule
   * is about export values, and this column holds none.
   */
  @Column({ name: 'version', type: 'integer' })
  version!: number;
}
