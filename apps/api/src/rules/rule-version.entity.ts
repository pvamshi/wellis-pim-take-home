import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Rule } from './rule.entity';

/**
 * A version's status. SQLite has no enum type and the legacy entities already
 * set the convention of `text` everywhere, so the union is TypeScript's job.
 */
export type RuleVersionStatus = 'active' | 'inactive';

/**
 * One version of a rule, as the "Database structure — Rules" section describes
 * it.
 *
 * `(ruleId, version)` is both the key of this row and the key the matching code
 * is written against (1.1.1), so one version number cannot address two rows of
 * code. Versions are never deleted — a rule goes inactive instead (1.1.8) — and
 * the partial unique index below is what makes "exactly one version per rule is
 * active" a fact of the database rather than a convention every future writer
 * has to remember.
 */
@Index('uq_rule_version_one_active_per_rule', ['ruleId'], {
  unique: true,
  where: "status = 'active'",
})
@Entity('rule_version')
export class RuleVersion {
  @PrimaryColumn({ name: 'rule_id', type: 'text' })
  ruleId!: string;

  @PrimaryColumn({ name: 'version', type: 'integer' })
  version!: number;

  /**
   * Inactive until something activates it. The only route to `active` is
   * `RuleVersionsService.activate`, which is where the one-active-version
   * invariant is kept (1.1.8); nothing becomes active by omission.
   */
  @Column({ name: 'status', type: 'text', default: 'inactive' })
  status!: RuleVersionStatus;

  /**
   * The revision queue (1.5.1). Set when the user declines this version
   * (1.2.6) and cleared by the revision workflow, never here.
   */
  @Column({ name: 'needs_review', type: 'boolean', default: false })
  needsReview!: boolean;

  /** Why the version was declined, when a reason was given. Optional (1.2.6). */
  @Column({ name: 'reason', type: 'text', nullable: true })
  reason!: string | null;

  /**
   * Declared against `rule_id` itself rather than a second column, so the
   * foreign key and the primary key are the same value: a version cannot exist
   * without the rule it versions.
   */
  @ManyToOne(() => Rule)
  @JoinColumn({ name: 'rule_id', referencedColumnName: 'ruleId' })
  rule!: Rule;
}
