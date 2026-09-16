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
 * `version` is the version the line names itself by — which is not where its
 * counts come from. The counts are all of the rule's rows, whatever version
 * made them, so that the number on a closed line is the number of rows opening
 * it shows (1.2.2). Everything else a rule knows about itself belongs to the
 * screen that expands one, not to the list that leads to it.
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
  /**
   * The version the line names: the active one, or the one waiting to be
   * rewritten when no version is active, or the highest written when there is
   * neither (1.1.8). It says which version the rule is now, and is not the
   * address of the counts beside it — a rule's rows may be spread over several
   * versions, and all of them are counted.
   */
  readonly version: number;
  /** Every row of this rule still awaiting a decision, whatever version made it. Zero when every change is applied. */
  readonly pending: number;
  /** Every row of this rule already approved and applied (1.2.2), whatever version made it. */
  readonly approved: number;
  /**
   * True when the version this line names is waiting for the revision workflow
   * (1.5.1) rather than being the rule's active one. Such a rule runs nothing
   * until its next version is written, and it is listed so the guidance it was
   * given can still be read and refined.
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
 * table is needed here. Counting a rule's rows asks nothing of a source but
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
  status: string;
  count: number | string;
}

/** How many of a rule's rows are waiting, and how many were applied. */
interface RuleCounts {
  pending: number;
  approved: number;
}

/**
 * The version a line names, out of every version that rule has.
 *
 * The active one, because that is the rule as it runs. With none — parked by a
 * decline (1.2.6) and not yet rewritten — the one queued for the rewrite, whose
 * guidance is read and refined on that line (1.5.1). With neither, the highest
 * written: the rule still has rows on this screen, and a line has to name a
 * version to be a line at all.
 *
 * The highest is found rather than taken from the head of the list, so the
 * answer does not quietly depend on the order the query happened to return.
 */
function namedVersion(versions: readonly RuleVersion[]): RuleVersion {
  return (
    versions.find((version) => version.status === 'active') ??
    versions.find((version) => version.needsReview) ??
    versions.reduce((highest, version) => (version.version > highest.version ? version : highest))
  );
}

/**
 * The rules screen's list (1.2.1).
 *
 * It lives here, beside the services that write the rules tables, because this
 * is the layer that owns them (1.1.3); the endpoint that serves it is a module
 * of its own, exactly as the presses are.
 *
 * Five things the code does not say on its own:
 *
 * - **The counts are the rule's, not one version's.** A rule's rows outlive the
 *   version that made them: parking a version for a rewrite leaves its rows
 *   exactly where they are (1.2.6), and activating a new version supersedes the
 *   old without moving them. Counting a single version therefore printed a
 *   number that disagreed with what opening the line showed — in both
 *   directions, a count with no rows under it and rows under a line with no
 *   count. One definition of a rule's findings, shared with
 *   `RuleDetailService`: all of them, whatever version made them.
 * - **The count is no longer what one press clears, and the screen says so.**
 *   `RuleApprovalsService.approveRule` moves the pending rows of the *active*
 *   version alone, so on a rule whose rows are spread over versions it clears
 *   fewer than the line counts. That is the panel's to explain — it names the
 *   version that button acts on — because the alternative was a count that hid
 *   findings to keep one button's arithmetic tidy.
 * - **A rule with no rows and no queued version is dropped rather than filtered
 *   in SQL.** 1.2.1's second scenario is a property of the join it describes,
 *   and doing it in memory keeps the three counts independent of the version
 *   read, which is what makes the query count constant.
 * - **Four queries, whatever the number of rules.** One for the versions with
 *   their rules, one grouped count per source table. Nothing here runs per
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
   * Every rule with a row waiting or applied, or with a version waiting to be
   * rewritten, and how many of each (1.2.1): the rules with work first, most
   * pending first, then the rules whose changes are all applied, most applied
   * first, then the versions queued for a rewrite.
   */
  async list(): Promise<RuleListEntry[]> {
    const written = await this.dataSource
      .getRepository(RuleVersion)
      .createQueryBuilder('version')
      // The rule is joined rather than fetched afterwards because every line
      // needs its name, and the screen has only this call to read it with.
      .innerJoinAndSelect('version.rule', 'rule')
      .orderBy('version.version', 'DESC')
      .getMany();

    const counts = await this.countRows();
    // Every version of a rule, because which one a line names is decided from
    // all of them and the counts belong to none of them in particular.
    const byRule = new Map<string, RuleVersion[]>();

    for (const version of written) {
      const versions = byRule.get(version.ruleId);

      if (versions === undefined) {
        byRule.set(version.ruleId, [version]);
      } else {
        versions.push(version);
      }
    }

    const entries = [...byRule.entries()].flatMap(([ruleId, versions]): RuleListEntry[] => {
      const count = counts.get(ruleId) ?? { pending: 0, approved: 0 };
      const named = namedVersion(versions);
      const queuedForRevision = named.needsReview;

      // A rule that has decided nothing and is waiting for nothing is not a
      // line. A rule queued for a rewrite is, whatever its counts: its guidance
      // is read there (1.5.1).
      if (!queuedForRevision && count.pending === 0 && count.approved === 0) {
        return [];
      }

      return [
        {
          ruleId,
          ruleName: named.rule.ruleName,
          version: named.version,
          pending: count.pending,
          approved: count.approved,
          ambiguous: named.rule.ambiguous,
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
   * How many rows each rule has waiting and applied, summed across the three
   * source tables and across every version of the rule.
   *
   * One grouped statement per table, never one per rule, and the three results
   * accumulate into a single map — a rule's scope may span two tables (1.1.6)
   * and the screen shows one number per rule, so the sum is the answer and a
   * per-source breakdown would be schema nobody asked for. Version is not
   * grouped on for the same reason: the line counts the rule.
   *
   * The count is coerced with `Number(...)` because an aggregate is not a
   * mapped column: a driver is free to hand `COUNT(*)` back as a string, and a
   * string would sort and add as text.
   */
  private async countRows(): Promise<Map<string, RuleCounts>> {
    const counts = new Map<string, RuleCounts>();

    for (const table of ruleTables) {
      const rows = await this.dataSource
        .getRepository(table)
        .createQueryBuilder('finding')
        .select('finding.ruleId', 'ruleId')
        .addSelect('finding.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('finding.status IN (:...statuses)', { statuses: ['pending', 'approved'] })
        .groupBy('finding.ruleId')
        .addGroupBy('finding.status')
        .getRawMany<StatusCount>();

      for (const row of rows) {
        const count = counts.get(row.ruleId) ?? { pending: 0, approved: 0 };

        if (row.status === 'pending') count.pending += Number(row.count);
        else count.approved += Number(row.count);

        counts.set(row.ruleId, count);
      }
    }

    return counts;
  }
}
