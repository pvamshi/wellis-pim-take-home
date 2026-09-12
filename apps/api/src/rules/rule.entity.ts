import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * A rule, as the "Database structure — Rules" section describes it.
 *
 * The rule itself holds only what is true of every version of it: its id, its
 * name, the description a human reads, and whether it is ambiguous. Everything
 * that changes from one version to the next — status, the review queue, the
 * reason — lives on `RuleVersion`, because 1.1.8 makes activity a property of a
 * version and not of the rule.
 */
@Entity('rule')
export class Rule {
  /**
   * Chosen by the rule's author, not generated: `(ruleId, version)` is the key
   * the code in the codebase is written against (1.1.1), so it is the identity
   * of the row as well. This is deliberately unlike the legacy tables, whose
   * ids come from an export and are not unique.
   */
  @PrimaryColumn({ name: 'rule_id', type: 'text' })
  ruleId!: string;

  @Column({ name: 'rule_name', type: 'text' })
  ruleName!: string;

  /**
   * For an ambiguous rule this is what the human reads in place of a proposed
   * value (1.1.12), so it is required rather than nullable.
   */
  @Column({ name: 'description', type: 'text' })
  description!: string;

  /**
   * True when the rule finds a problem it cannot fix. Rule-wide, never
   * per-row (1.1.12), and with no default: a rule that silently claimed it
   * could fix what it found is exactly the failure this flag exists to
   * prevent, so its author has to say.
   */
  @Column({ name: 'ambiguous', type: 'boolean' })
  ambiguous!: boolean;
}
