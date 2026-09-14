import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { LegacySourceTable } from '../legacy/legacy-source-table';

/**
 * A row somebody threw out (1.6.2, 1.6.6).
 *
 * One table across all three legacy sources, kept apart from the six legacy
 * tables the same way `Duplicate` is: a rejection is not a fact about one
 * source, it is a decision that spans all three.
 *
 * Keyed `(source_table, legacy_id)`, with no surrogate id. A legacy id names a
 * row without identifying one (1.0.3) — two data rows may share it — so this
 * is not a key to one row of `legacy_patient`/`legacy_intake`/`legacy_consent`
 * either; it is the same address the findings tables already use
 * (`LegacyRuleRow`'s `legacy_id`), and the rows screen's unit besides (1.6.1).
 * Unlike `Duplicate`, which links two arbitrary ids with no natural key of its
 * own, this pair *is* the address, so no `id` column is added on top of it.
 *
 * `source_table` is declared first so the composite key's leading column
 * matches the one query this screen actually runs: every rejection for one
 * source. The column is `source_table`, not `table` — a reserved word, and
 * the name `Duplicate.sourceTable` already uses for the same concept — but the
 * TS property stays `table`, matching every row-address type already in the
 * codebase (`RuleRowAddress.table`, `RuleDetailRow.table`).
 *
 * `reason` is nullable, matching every other reason column in the schema
 * (`RuleVersion.reason`, `LegacyRuleRow.reason`): 1.6.6 shows an example with
 * one but never says it is mandatory.
 *
 * No status or active column. Presence of the row *is* "rejected", exactly the
 * way presence of a `Duplicate` row *is* "X duplicates Y" — reversing a
 * rejection (1.6.6 says it is free) is a future DELETE, not a flag flip, so no
 * column is needed for it here.
 *
 * No foreign key, for the same reason the per-source rule tables carry none
 * (`LegacyRuleRow`'s comment): `legacy_id` is not unique, so there is no key
 * for a constraint to point at.
 */
@Entity('row_rejection')
export class RowRejection {
  /** Which legacy source the rejected row belongs to. */
  @PrimaryColumn({ name: 'source_table', type: 'text' })
  table!: LegacySourceTable;

  /**
   * Theirs, and not unique (1.0.3) — names the row this rejection is about, it
   * does not identify one.
   */
  @PrimaryColumn({ name: 'legacy_id', type: 'text' })
  legacyId!: string;

  /** Why the row was rejected, when a reason was given (1.6.6). Optional. */
  @Column({ name: 'reason', type: 'text', nullable: true })
  reason!: string | null;
}
