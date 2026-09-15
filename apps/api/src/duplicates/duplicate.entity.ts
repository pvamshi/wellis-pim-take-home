import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
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
 * A link's status (1.7.3). `pending` → `confirmed` | `dismissed`, both final —
 * nothing here enforces that transition; the screen and its write path do
 * (1.7.5, 1.7.6), the same split every other status column in this schema
 * draws between what a column can hold and who decides which value it holds
 * next.
 */
export type DuplicateStatus = 'pending' | 'confirmed' | 'dismissed';

/**
 * A duplicate link, as the "Database structure — Duplicates" section describes
 * it, widened by 1.7.1 to name the physical rows a legacy id alone cannot.
 *
 * One table across all three legacy sources, kept apart so duplicate
 * information does not pollute every legacy row. It says one thing: id X is a
 * duplicate of id Y (1.1.13). It is not field-shaped and does not need to be —
 * writing this row changes no column of either legacy row.
 *
 * A legacy id names a row without identifying one (1.0.3): two intakes sharing
 * an intake id, or two consent events sharing a patient id, are the same
 * legacy id twice. A link between two such ids would identify nothing, so
 * `duplicateRowId`/`canonicalRowId` carry the row each side actually means —
 * the same generated `id` every legacy entity already keeps for exactly this
 * reason ("ours, not theirs"). The legacy-id columns stay, because the screen
 * still shows X and Y by the id a human recognises (1.7.4).
 *
 * Two things it deliberately does not do:
 *
 * - It does not retire X. That waits on a status column legacy rows do not have
 *   — the `status` they do have is the export's own value, not a workflow state
 *   — and nothing reads this table to filter X out yet (1.7.8).
 * - It does not carry the values that move from X to Y. Anything that has to
 *   move is an ordinary rule row against Y with duplication as its reason
 *   (1.1.13), so merging reuses 1.1.7 and 1.2.5 and needs nothing here.
 *
 * No foreign keys, for the same two reasons the per-source rule tables carry
 * none: a legacy id names a row without identifying one, because two rows may
 * share it (1.0.3), and `(rule_id, version)` cannot go stale because versions
 * are never deleted (1.1.8). The two row-id columns get none either, even
 * though a row id is individually unique: one shared table serves three
 * sources, and a conditional per-source-table foreign key is not expressible
 * on one column.
 *
 * Unique on `(sourceTable, duplicateRowId, canonicalRowId)` — the ordered pair,
 * not a normalised or symmetric one. "Y is the earlier row in export order" is
 * the rules' own convention (1.7.2), so two rules finding the same physical
 * pair agree on which side is which; this is the database-level backstop
 * behind "skip a pair already linked in any status" (1.7.2), which
 * `RuleFindingsService.persist` enforces first.
 */
@Index(['sourceTable', 'duplicateRowId', 'canonicalRowId'], { unique: true })
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

  /** X — the id that duplicates, as a human reads it. */
  @Column({ name: 'duplicate_legacy_id', type: 'text' })
  duplicateLegacyId!: string;

  /**
   * X — the physical row, since a legacy id alone may name more than one
   * (1.0.3, 1.7.1). This, not `duplicateLegacyId`, is half of the unique pair.
   */
  @Column({ name: 'duplicate_row_id', type: 'text' })
  duplicateRowId!: string;

  /** Y — the one that survives, as a human reads it. */
  @Column({ name: 'canonical_legacy_id', type: 'text' })
  canonicalLegacyId!: string;

  /** Y — the physical row (1.7.1), the other half of the unique pair. */
  @Column({ name: 'canonical_row_id', type: 'text' })
  canonicalRowId!: string;

  /** The rule that found the link, and the version of it that ran. */
  @Column({ name: 'rule_id', type: 'text' })
  ruleId!: string;

  /**
   * Integer, matching `rule_version.version`. The legacy tables' text-only rule
   * is about export values, and this column holds none.
   */
  @Column({ name: 'version', type: 'integer' })
  version!: number;

  /**
   * `pending` until a human confirms or dismisses it (1.7.3, 1.7.5, 1.7.6).
   * Defaulted for the same reason `RuleVersion.status` is, but
   * `RuleFindingsService.persist` sets it explicitly on every insert rather
   * than relying on the default — a decision hidden in a schema default is a
   * decision nobody can see.
   */
  @Column({ name: 'status', type: 'text', default: 'pending' })
  status!: DuplicateStatus;
}
