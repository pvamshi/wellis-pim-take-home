import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A rule row's status. SQLite has no enum type and `rule-version.entity.ts`
 * already set the convention that the union is TypeScript's job, not the
 * column's.
 */
export type LegacyRuleStatus = 'pending' | 'approved' | 'declined';

/**
 * The shape of a rule row, as the "Database structure — Legacy data" section
 * describes `LegacyPatientRule`.
 *
 * Written once and extended by the three `@Entity` classes below, because the
 * three per-source tables are identical and writing the same eight columns out
 * three times invites them to drift. TypeORM collects a class's metadata along
 * its prototype chain, so an undecorated abstract base contributes its columns
 * and its index to every subclass while remaining no table of its own.
 *
 * A row is one proposed change to one column of one legacy row — the
 * field-shaped finding of 1.1.7, which is the only shape there is. There is no
 * surrogate id: `(legacy_id, rule_id, version, column)` *is* the address of a
 * finding, so it is the key.
 *
 * Two foreign keys are deliberately absent:
 *
 * - None from `legacy_id` to the legacy data table. Legacy ids are not unique —
 *   one file may carry the same id twice and both rows are kept (1.0.3) — so
 *   there is no key for a constraint to point at. This is the same reasoning
 *   `legacy_consent.patient_legacy_id` already carries.
 * - None from `(rule_id, version)` to `rule_version`. The database structure
 *   annotates the one foreign key it wants, `RuleVersion.ruleId -> Rule`, and
 *   annotates none here; versions are never deleted (1.1.8), so the recorded
 *   key cannot go stale.
 */
@Index(['ruleId', 'version'])
export abstract class LegacyRuleRow {
  /**
   * Theirs, and not unique (1.0.3) — the id names the legacy row the finding is
   * about, it does not identify one. The table name already says which source
   * it belongs to, so the column is `legacy_id` in all three rather than a
   * per-source name; 1.1.14's finding contract calls it `legacyId` too.
   */
  @PrimaryColumn({ name: 'legacy_id', type: 'text' })
  legacyId!: string;

  /** The rule that proposed this change, and the version of it that ran. */
  @PrimaryColumn({ name: 'rule_id', type: 'text' })
  ruleId!: string;

  /**
   * Integer, matching `rule_version.version` — the legacy tables' text-only
   * rule is about export values, and this column holds none. Part of the key so
   * a later version's finding cannot overwrite an earlier version's history
   * (1.2.9, 1.3).
   */
  @PrimaryColumn({ name: 'version', type: 'integer' })
  version!: number;

  /** The column of the legacy row the rule tested, and so changes (1.1.5). */
  @PrimaryColumn({ name: 'column', type: 'text' })
  column!: string;

  /** What the column held when the rule ran. Null when it held nothing. */
  @Column({ name: 'previous_value', type: 'text', nullable: true })
  previousValue!: string | null;

  /**
   * What the rule proposes instead. Null throughout for an ambiguous rule,
   * which finds a problem it cannot fix (1.1.12); the rule's description is
   * what the human reads in its place.
   */
  @Column({ name: 'next_value', type: 'text', nullable: true })
  nextValue!: string | null;

  /**
   * Pending until somebody decides. Mirrors `rule_version.status` defaulting to
   * `'inactive'`: a written finding waits for a decision and nothing is applied
   * by omission.
   */
  @Column({ name: 'status', type: 'text', default: 'pending' })
  status!: LegacyRuleStatus;

  /** Why this row was declined, when a reason was given. Optional (1.2.7). */
  @Column({ name: 'reason', type: 'text', nullable: true })
  reason!: string | null;
}

/** Findings against `legacy_patient`. */
@Entity('legacy_patient_rule')
export class LegacyPatientRule extends LegacyRuleRow {}

/** Findings against `legacy_intake`. */
@Entity('legacy_intake_rule')
export class LegacyIntakeRule extends LegacyRuleRow {}

/** Findings against `legacy_consent`. */
@Entity('legacy_consent_rule')
export class LegacyConsentRule extends LegacyRuleRow {}
