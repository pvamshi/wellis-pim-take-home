import { Injectable } from '@nestjs/common';
import { DataSource, type EntityTarget } from 'typeorm';
import {
  LegacyConsentRule,
  LegacyIntakeRule,
  LegacyPatientRule,
  type LegacyRuleRow,
} from '../legacy/legacy-rule.entity';
import { RuleVersion } from './rule-version.entity';

/**
 * One line of the rules screen (1.2.1): a rule that has work waiting, or one
 * whose changes have all been applied.
 *
 * Six fields and no more. `ruleName` is how a line names the rule it is, and
 * `version` is the half of the address the count belongs to — 1.2.1 filters on
 * the active version, and every row action is addressed by `(ruleId, version)`.
 * Everything else a rule knows about itself belongs to the screen that expands
 * one, not to the list that leads to it.
 *
 * `ambiguous` is the exception, and earns its place by changing what opening a
 * line costs. An ambiguous rule's rows cannot be ticked through in a batch
 * (1.1.12) — each one needs a value typed into it — so "120 pending" means an
 * afternoon on one line and a second on another, and which it is has to be
 * readable before the line is opened. It is free to send: the `rule` row is
 * already joined for the name.
 *
 * `approved` is what keeps a finished rule on the screen. Without it a rule
 * whose every change was applied would leave no trace of what it changed.
 */
export interface RuleListEntry {
  readonly ruleId: string;
  readonly ruleName: string;
  /** The active version, and so the version the counts belong to (1.1.8). */
  readonly version: number;
  /** Rows of this rule and version still awaiting a decision. Zero when every change is applied. */
  readonly pending: number;
  /** Rows of this rule and version already approved and applied (1.2.2). */
  readonly approved: number;
  /**
   * True when this line is a version waiting for the revision workflow (1.5.1)
   * rather than the rule's active one. Such a rule runs nothing until its next
   * version is written, and it is listed so the guidance it was given can still
   * be read and refined.
   */
  readonly queuedForRevision: boolean;
  /** Whether this rule proposes values or only reports what it cannot fix (1.1.12). */
  readonly ambiguous: boolean;
}

/**
 * The three tables a finding can land in (1.1.14).
 *
 * A plain list, not the keyed map `rule-findings.service.ts` and
 * `rule-approvals.service.ts` each keep: neither the short name nor the data
 * table is needed here. Counting pending rows asks nothing of a source but
 * which table to count, and a rule's scope may span all three (1.1.6), so all
 * three are always read.
 */
const ruleTables: readonly EntityTarget<LegacyRuleRow>[] = [
  LegacyPatientRule,
  LegacyIntakeRule,
  LegacyConsentRule,
];

/** One grouped count of one status, as the driver hands it back. */
interface StatusCount {
  ruleId: string;
  version: number;
  status: string;
  count: number | string;
}

/** How many of one version's rows are waiting, and how many were applied. */
interface VersionCounts {
  pending: number;
  approved: number;
}

/**
 * The key the counts are accumulated under: `(ruleId, version)` as one string.
 *
 * The version goes first, because it is the half that cannot contain the
 * separator. Read back, everything before the first colon is the version and
 * everything after it is the rule id, so no two different pairs can produce the
 * same key — which `${ruleId}:${version}` would not guarantee, rule ids being
 * their authors' to choose.
 */
function pendingKey(ruleId: string, version: number): string {
  return `${version}:${ruleId}`;
}

/**
 * The rules screen's list (1.2.1).
 *
 * It lives here, beside the services that write the rules tables, because this
 * is the layer that owns them (1.1.3); the endpoint that serves it is a module
 * of its own, exactly as the presses are.
 *
 * Four things the code does not say on its own:
 *
 * - **The count is keyed on `(ruleId, version)`, not on the rule.** It has to
 *   equal what the Approve button on that rule would clear, and
 *   `RuleApprovalsService.approveRule` moves exactly the pending rows of the
 *   *active* version. Pending rows left behind by a superseded version — which
 *   a rule-level decline deliberately leaves lying around (1.2.6) — therefore
 *   do not count, and cannot put a rule back on the screen carrying a number no
 *   press can move.
 * - **A rule with nothing pending is dropped rather than filtered in SQL.**
 *   1.2.1's second scenario is a property of the join it describes: the screen
 *   is the active versions that have at least one pending row, so a zero sum is
 *   simply not a line. Doing it in memory keeps the three counts independent of
 *   the version read, which is what makes the query count constant.
 * - **Four queries, whatever the number of rules.** One for the active versions
 *   with their rules, one grouped count per source table. Nothing here runs per
 *   rule — a screen whose cost grows with the catalogue would get slower every
 *   time a rule is written.
 * - **Rules are read as entities, not as raw rows.** No table or column name is
 *   written out as a string, and the version and the name arrive already typed.
 *   Only `COUNT(*)` comes back raw, because there is no entity for an
 *   aggregate.
 */
@Injectable()
export class RuleListService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Every rule whose active version has at least one pending or approved row,
   * with how many of each (1.2.1): the rules with work first, most pending
   * first, then the rules whose changes are all applied, most applied first.
   */
  async list(): Promise<RuleListEntry[]> {
    const listable = await this.dataSource
      .getRepository(RuleVersion)
      .createQueryBuilder('version')
      // The rule is joined rather than fetched afterwards because every line
      // needs its name, and the screen has only this call to read it with.
      .innerJoinAndSelect('version.rule', 'rule')
      .where('version.status = :status', { status: 'active' })
      // A version waiting for the revision workflow (1.5.1) is listed too: it
      // runs nothing, so it has no work, but the guidance it was given is read
      // and refined on its line. A rule with both is shown by its active one.
      .orWhere('version.needsReview = :needsReview', { needsReview: true })
      .orderBy('version.version', 'DESC')
      .getMany();

    const counts = await this.countRows();
    const shown = new Map<string, RuleVersion>();

    for (const version of listable) {
      const chosen = shown.get(version.ruleId);

      if (chosen === undefined || (chosen.status !== 'active' && version.status === 'active')) {
        shown.set(version.ruleId, version);
      }
    }

    const entries = [...shown.values()].flatMap((version): RuleListEntry[] => {
      const count = counts.get(pendingKey(version.ruleId, version.version)) ?? {
        pending: 0,
        approved: 0,
      };
      const queuedForRevision = version.status !== 'active';

      if (!queuedForRevision && count.pending === 0 && count.approved === 0) {
        return [];
      }

      return [
        {
          ruleId: version.ruleId,
          ruleName: version.rule.ruleName,
          version: version.version,
          pending: count.pending,
          approved: count.approved,
          ambiguous: version.rule.ambiguous,
          queuedForRevision,
        },
      ];
    });

    // Most pending first (1.2.1), so a rule with nothing pending sorts after
    // every rule with work; among those, most applied first. A version waiting
    // to be rewritten sorts behind all of them: it runs nothing, so its counts
    // are not work anyone can do from this screen.
    return entries.sort(
      (left, right) =>
        Number(left.queuedForRevision) - Number(right.queuedForRevision) ||
        right.pending - left.pending ||
        right.approved - left.approved,
    );
  }

  /**
   * How many pending rows each `(ruleId, version)` has, summed across the three
   * source tables.
   *
   * One grouped statement per table, never one per rule, and the three results
   * accumulate into a single map — a rule's scope may span two tables (1.1.6)
   * and the screen shows one number per rule, so the sum is the answer and a
   * per-source breakdown would be schema nobody asked for.
   *
   * The count is coerced with `Number(...)` because an aggregate is not a
   * mapped column: a driver is free to hand `COUNT(*)` back as a string, and a
   * string would sort and add as text.
   */
  private async countRows(): Promise<Map<string, VersionCounts>> {
    const counts = new Map<string, VersionCounts>();

    for (const table of ruleTables) {
      const rows = await this.dataSource
        .getRepository(table)
        .createQueryBuilder('finding')
        .select('finding.ruleId', 'ruleId')
        .addSelect('finding.version', 'version')
        .addSelect('finding.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('finding.status IN (:...statuses)', { statuses: ['pending', 'approved'] })
        .groupBy('finding.ruleId')
        .addGroupBy('finding.version')
        .addGroupBy('finding.status')
        .getRawMany<StatusCount>();

      for (const row of rows) {
        const key = pendingKey(row.ruleId, row.version);
        const count = counts.get(key) ?? { pending: 0, approved: 0 };

        if (row.status === 'pending') count.pending += Number(row.count);
        else count.approved += Number(row.count);

        counts.set(key, count);
      }
    }

    return counts;
  }
}
