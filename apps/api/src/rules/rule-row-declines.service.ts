import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager, type EntityTarget } from 'typeorm';
import {
  LegacyConsentRule,
  LegacyIntakeRule,
  LegacyPatientRule,
  type LegacyRuleRow,
} from '../legacy/legacy-rule.entity';

/**
 * The short name a row address carries (1.1.14) to the table holding findings
 * against that source.
 *
 * A third small map, deliberately: `rule-findings.service.ts` has one that maps
 * to the same three entities and `rule-approvals.service.ts` has one that
 * carries the data table and its legacy id property beside them. Neither is
 * what this file needs — a decline writes the rule row and nothing else, so it
 * needs the rule table and nothing else — and `rule-approvals.service.ts`
 * already states the preference: two small maps that each say what their own
 * file needs beat one shared map that says more than either.
 *
 * A `Map` keyed on plain strings rather than a `Record<LegacySourceTable, …>`,
 * for the reason both of those files give: the union is a compile-time
 * guarantee and a row address is JSON that crossed a boundary, so the lookup
 * has to be able to miss.
 */
const declinableTables = new Map<string, EntityTarget<LegacyRuleRow>>([
  ['patient', LegacyPatientRule],
  ['intake', LegacyIntakeRule],
  ['consent', LegacyConsentRule],
]);

/**
 * The reason as it is stored: trimmed, and null when there is nothing in it.
 *
 * Copied from `rule-versions.service.ts`, which normalises a *version's* reason
 * the same way for 1.2.6, rather than imported from it: a row's reason and a
 * version's reason are written by two different presses onto two different
 * tables, and the one thing that must not differ between them is what the
 * stored value means. So the rule is restated where the write is, and a row
 * holding `" "` is no more a reason here than it is there — the revision
 * workflow (1.5.1) and the screen would both read a stray space as feedback
 * Vamshi typed.
 */
function storedReason(reason: string | null | undefined): string | null {
  if (typeof reason !== 'string') {
    return null;
  }

  const trimmed = reason.trim();

  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The full address of the rule row being crossed out: the four-part primary key
 * of a finding, plus the source whose rule table holds it.
 *
 * Declared here rather than shared with `rule-approvals.service.ts`, which
 * exports the same five fields as `RuleRowAddress`. The two presses are
 * independent — a decline is not an approval — and the alternative would make
 * this file depend on the approve path for the shape of its own argument. The
 * duplication is five readonly fields and the codebase already takes that trade
 * twice, for the source maps above.
 */
export interface RuleRowDeclineAddress {
  /** `patient`, `intake` or `consent` (1.1.14). */
  readonly table: string;
  readonly legacyId: string;
  readonly ruleId: string;
  /** Integer, matching `rule_version.version`. */
  readonly version: number;
  /** The database column of the legacy table the finding names. */
  readonly column: string;
}

/**
 * What one press of Decline all on a row did (1.6.5).
 *
 * `table` and `legacyId` echo the address, the way `RuleRowDeclineReport`
 * echoes `ruleId`: there is no single `ruleId` or `version` here, because
 * this press declines every pending finding on the row, whichever rule and
 * version proposed it.
 */
export interface RowDeclineAllReport {
  /** `patient`, `intake` or `consent` (1.1.14). */
  readonly table: string;
  readonly legacyId: string;
  /** Every pending rule row this press moved to declined, ambiguous included. */
  readonly declined: number;
  /**
   * The reason stored on every one of them, or null when none was given.
   * Null too when nothing was declined, because then nothing was stored.
   */
  readonly reason: string | null;
}

/** What one press of the row-level cross did (1.2.7). */
export interface RuleRowDeclineReport {
  readonly ruleId: string;
  /**
   * The version named by the address. Never null: a row-level press addresses
   * one rule row, and the version is part of that address — unlike the
   * rule-level presses, which have to find the active version for themselves.
   */
  readonly version: number;
  /**
   * Rule rows moved to declined: one, or none when the address matched nothing
   * still pending. Never more — the address is a primary key.
   */
  readonly declined: number;
  /**
   * The reason stored on that row, or null when none was given (1.2.7). Null
   * too when nothing was declined, because then nothing was stored.
   */
  readonly reason: string | null;
}

/**
 * The row-level cross with "modify the rule" unticked (1.2.7): this row is
 * wrong, the rule is fine.
 *
 * A file of its own, and not a method on either service beside it:
 *
 * - Not `RuleApprovalsService`, because a decline is not an approval. That
 *   service applies accepted changes — it resolves the legacy column, counts
 *   the data rows a finding addresses and writes them inside 1.2.5's
 *   transaction. A decline does none of that: it records a decision and touches
 *   no data at all.
 * - Not `RuleVersionsService`, which is declared to be the one write path onto
 *   `rule_version`. 1.2.7 says in so many words that the rule is untouched, so
 *   this press must never reach that table. Parking the version is the *ticked*
 *   cross (1.2.8), a different press with a route of its own.
 *
 * It is still the same shared persistence layer 1.1.3 names — the rule tables
 * are written here and never in rule code.
 *
 * Three things the code does not say on its own:
 *
 * - **Pending is part of the lookup, not a check after it.** An approved row is
 *   settled (1.2.11) and a row already declined carries the reason the decline
 *   that actually happened gave it, which a second press must not overwrite.
 *   Both simply leave this press with nothing of its own to do — the same
 *   reading `RuleApprovalsService.approveRow` already takes.
 * - **The count comes from the row that was found**, not from
 *   `UpdateResult.affected`, which drivers report inconsistently. It is read
 *   inside the same transaction as the write, so nothing can have moved
 *   underneath it.
 * - **1.2.9's "forever" is not enforced here.** This press writes one row;
 *   what makes it permanent is `RuleFindingsService` skipping any finding whose
 *   `(legacyId, ruleId, column)` is declined, whatever version proposes it
 *   next. The decline is looked up there, so the only thing this service owes
 *   1.2.9 is that the row it writes says `declined`.
 */
@Injectable()
export class RuleRowDeclinesService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Declines one rule row, addressed by its primary key, with the reason the
   * user gave if they gave one (1.2.7).
   *
   * Nothing else is written. Not the rule, not its version, not the legacy data
   * row the finding is about — the whole of 1.2.7 is that this row's status
   * becomes declined, so the rule's other rows stay pending and approvable and
   * the column keeps the value it already had.
   *
   * One transaction around the lookup and the write, so the two cannot straddle
   * another press. An address matching nothing still pending — an unknown
   * table, an unknown key, a row already decided — declines nothing, writes
   * nothing and says so in `declined` rather than failing: the operator is one
   * of us pressing from a screen that may be a moment stale (1.2.12), and it is
   * the line both the approve endpoints and the rule-level decline already draw.
   */
  async declineRow(
    address: RuleRowDeclineAddress,
    reason?: string | null,
  ): Promise<RuleRowDeclineReport> {
    const { table, legacyId, ruleId, version, column } = address;
    const stored = storedReason(reason);

    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const nothing: RuleRowDeclineReport = { ruleId, version, declined: 0, reason: null };
      const entity = declinableTables.get(table);

      if (entity === undefined) {
        return nothing;
      }

      // Every pending column this version proposes on the row, not only the
      // named one: a fix that spans columns is one atom (1.1.4), declined
      // together.
      const atom = await manager
        .getRepository(entity)
        .find({ where: { legacyId, ruleId, version, status: 'pending' } });

      if (!atom.some((row) => row.column === column)) {
        return nothing;
      }

      await manager.update(
        entity,
        { legacyId, ruleId, version, status: 'pending' },
        { status: 'declined', reason: stored },
      );

      return { ruleId, version, declined: atom.length, reason: stored };
    });
  }

  /**
   * Declines every pending finding on one row, ambiguous ones included — the
   * row-wide cross (1.6.5).
   *
   * Unlike `approveAllOnRow` (`rule-approvals.service.ts`), there is nothing
   * here to filter: the cross needs no proposal to press, so every pending
   * row of the source `table` names is taken, whichever rule or version
   * proposed it. That is what lets this be one blanket `UPDATE` where the
   * approve side needs a per-row one — there is no ambiguous row this press
   * has to leave behind.
   *
   * It never touches `rule_version`. This service has no dependency capable
   * of reaching that table at all, so "a row-wide decline does not park a
   * rule version (1.2.8)" is a fact about the code, not a check inside it —
   * the same guarantee `declineRow` above already gives for a single finding.
   *
   * The rows are read before they are written, so the count comes from what
   * was actually found rather than from `UpdateResult.affected`, which
   * drivers report inconsistently — the same reasoning `declineRow` gives,
   * extended to a set instead of one row. Both happen inside one transaction,
   * so nothing can move between the two.
   *
   * An unknown `table`, or a row with nothing pending, declines nothing and
   * says so with `declined: 0` and `reason: null` rather than failing — the
   * same "count, not a fault" line every other press in this codebase draws.
   */
  async declineAllOnRow(
    table: string,
    legacyId: string,
    reason?: string | null,
  ): Promise<RowDeclineAllReport> {
    const stored = storedReason(reason);

    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const nothing: RowDeclineAllReport = { table, legacyId, declined: 0, reason: null };
      const entity = declinableTables.get(table);

      if (entity === undefined) {
        return nothing;
      }

      const rows = await manager.getRepository(entity).find({ where: { legacyId, status: 'pending' } });

      if (rows.length === 0) {
        return nothing;
      }

      await manager.update(entity, { legacyId, status: 'pending' }, { status: 'declined', reason: stored });

      return { table, legacyId, declined: rows.length, reason: stored };
    });
  }
}
