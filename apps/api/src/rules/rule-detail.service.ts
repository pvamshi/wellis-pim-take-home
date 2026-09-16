import { Injectable } from '@nestjs/common';
import { DataSource, type EntityTarget } from 'typeorm';
import {
  LegacyConsentRule,
  LegacyIntakeRule,
  LegacyPatientRule,
  type LegacyRuleRow,
} from '../legacy/legacy-rule.entity';
import type { LegacySourceTable } from '../legacy/legacy-source-table';
import { RuleVersion } from './rule-version.entity';
import { Rule } from './rule.entity';

/**
 * One row of an expanded rule (1.2.2), before and after (1.2.3).
 *
 * Five fields and no more. `ruleId` and `version` are deliberately absent:
 * they are the same on every row of a detail, so they sit on the detail once —
 * repeating them 340 times says nothing new, and a row action takes the rule id
 * from the URL and the version from the detail it was read from.
 *
 * The address is still complete. `(table, legacyId, column)` plus the detail's
 * `ruleId` and `version` is exactly the five-part row address the tick and the
 * cross take (1.2.4, 1.2.7), so a row on the screen can be acted on without a
 * second read.
 */
export interface RuleDetailRow {
  /** Which legacy source the row is in (1.1.14), so a row action can name it. */
  readonly table: LegacySourceTable;
  /** Theirs, and not unique (1.0.3) — it names a row, it does not identify one. */
  readonly legacyId: string;
  /** The column the rule tested, and so the column it changes (1.1.5). */
  readonly column: string;
  /** What that column held when the rule ran. Null when it held nothing. */
  readonly previousValue: string | null;
  /**
   * What the rule proposes instead — absent entirely on an ambiguous rule
   * (1.1.12, 1.2.3), whose rows have no proposed value at all.
   *
   * Absent rather than null, because null is a value a rule may legitimately
   * propose: clearing a column. Sending null for both states would leave the
   * screen unable to tell "there is no fix, read the description" from "the fix
   * is to empty this column".
   */
  readonly nextValue?: string | null;
}

/**
 * One expanded rule: what it is, and its two sections (1.2.2).
 *
 * `description` and `ambiguous` are here because 1.2.3's second sentence needs
 * both — an ambiguous rule's rows show the previous value and the rule's
 * description in place of a new value, and only the rule knows which it is.
 * They are on the detail rather than on each row for the same reason 1.1.12
 * gives: ambiguity is a property of the rule, never of the row.
 */
export interface RuleDetail {
  readonly ruleId: string;
  readonly ruleName: string;
  /** For an ambiguous rule, what the human reads instead of a value (1.1.12). */
  readonly description: string;
  /** True when this rule finds problems it cannot fix (1.1.12). */
  readonly ambiguous: boolean;
  /**
   * The active version, and so the version both sections belong to (1.1.8).
   * Null when the rule has no active version — declined and not yet revised
   * (1.2.6), or written but never activated.
   */
  readonly version: number | null;
  /** Rows still awaiting a decision (1.2.2). Empty when there are none. */
  readonly pending: RuleDetailRow[];
  /** Rows already approved and applied (1.2.2). Empty when there are none. */
  readonly approved: RuleDetailRow[];
  /**
   * What a human last told this rule to do differently (1.5.1), in their words,
   * kept on the version they told it against. Null when nobody has.
   *
   * It is on the detail so the screen can show it back rather than an empty
   * box: guidance is refined, not retyped, and a box that forgets what was
   * already said invites the same sentence to be written twice.
   */
  readonly guidance: string | null;
  /** The version that guidance is stored on. Null when there is none. */
  readonly guidanceVersion: number | null;
  /** True when that version is waiting for the revision workflow to rewrite it. */
  readonly queuedForRevision: boolean;
}

/** The rule table of one legacy source, under the short name a row names. */
interface DetailSource {
  readonly table: LegacySourceTable;
  readonly entity: EntityTarget<LegacyRuleRow>;
}

/**
 * The three tables a finding can land in (1.1.14), in the order the sections
 * list them.
 *
 * A list of pairs rather than the keyed maps `rule-findings.service.ts` and
 * `rule-approvals.service.ts` each keep: nothing here looks a source up by
 * name — all three are always read, because a rule's scope may span them
 * (1.1.6) — and what this file needs from a source is the opposite direction,
 * the short name to put on every row it produced.
 *
 * The order is part of the answer. Nothing specifies one, and a screen that
 * reshuffles its rows between two loads is worse than an arbitrary but fixed
 * order, so the sections are built in this order and each source's rows are
 * read ordered by legacy id and then column.
 */
const detailSources: readonly DetailSource[] = [
  { table: 'patient', entity: LegacyPatientRule },
  { table: 'intake', entity: LegacyIntakeRule },
  { table: 'consent', entity: LegacyConsentRule },
];

/** The two sections (1.2.2), and so the only statuses this read asks for. */
const shownStatuses = ['pending', 'approved'] as const;

/**
 * One expanded rule, with its pending and approved rows (1.2.2, 1.2.3).
 *
 * It lives here, beside the services that write the rules tables and beside
 * `RuleListService`, because this is the layer that owns them (1.1.3); the
 * endpoint that serves it is a module of its own, exactly as the list and the
 * presses are.
 *
 * Five things the code does not say on its own:
 *
 * - **Both sections are the active version's rows.** That is the same
 *   `(ruleId, version)` the list counts and every row action sends back, so
 *   every row on the screen is one a tick or a cross can move. A superseded
 *   version's rows — which a rule-level decline deliberately leaves lying
 *   around (1.2.6) — are history, not work.
 * - **A rule with no active version is a state, not a failure.** It answers
 *   with `version: null` and two empty sections, the same answer
 *   `RuleApprovalsService.approveRule` and `RuleVersionsService.decline` give
 *   when a press finds no active version. A rule parked by a decline is a real
 *   rule the screen can be pointed at.
 * - **A rule id nobody has written answers null**, and the controller turns
 *   that into a 404. Inventing a name and a description for a rule that does
 *   not exist would be worse than saying it is not there.
 * - **Two sections, never three.** 1.2.2 names pending and approved; a declined
 *   row is settled (1.2.7) and belongs to neither. The filter is therefore on
 *   the two statuses that are shown, not on "not declined" — a status added
 *   later would have to be placed deliberately rather than leaking onto the
 *   screen.
 * - **At most five queries, whatever the number of rows.** One for the rule,
 *   one for its active version, one per source table. Nothing runs per row, and
 *   the rows come back as entities — no table or column name is written out as
 *   a string.
 */
@Injectable()
export class RuleDetailService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The rule, its active version, and that version's pending and approved rows
   * (1.2.2). Null when there is no such rule.
   */
  async detail(ruleId: string): Promise<RuleDetail | null> {
    const rule = await this.dataSource.getRepository(Rule).findOne({ where: { ruleId } });

    if (rule === null) {
      return null;
    }

    const versions = await this.dataSource
      .getRepository(RuleVersion)
      .find({ where: { ruleId }, order: { version: 'DESC' } });
    const active = versions.find((version) => version.status === 'active') ?? null;

    // The guidance to show back is the one still waiting to be acted on; with
    // none waiting, the last thing anyone said about any version of this rule.
    const queued = versions.find((version) => version.needsReview) ?? null;
    const spoken = queued ?? versions.find((version) => version.reason !== null) ?? null;

    const detail = {
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      description: rule.description,
      ambiguous: rule.ambiguous,
      guidance: spoken === null ? null : spoken.reason,
      guidanceVersion: spoken === null ? null : spoken.version,
      queuedForRevision: queued !== null,
    };

    if (active === null) {
      // No further query: there is no version for rows to belong to, and rows
      // of an inactive version are not this screen's.
      return { ...detail, version: null, pending: [], approved: [] };
    }

    const pending: RuleDetailRow[] = [];
    const approved: RuleDetailRow[] = [];

    for (const source of detailSources) {
      const rows = await this.dataSource
        .getRepository(source.entity)
        .createQueryBuilder('finding')
        .where('finding.ruleId = :ruleId', { ruleId })
        .andWhere('finding.version = :version', { version: active.version })
        .andWhere('finding.status IN (:...statuses)', { statuses: [...shownStatuses] })
        .orderBy('finding.legacyId', 'ASC')
        .addOrderBy('finding.column', 'ASC')
        .getMany();

      for (const row of rows) {
        (row.status === 'pending' ? pending : approved).push(
          detailRow(source.table, row, rule.ambiguous),
        );
      }
    }

    return { ...detail, version: active.version, pending, approved };
  }
}

/**
 * One stored rule row as the screen reads it.
 *
 * The ambiguous branch builds an object without the key rather than one with
 * `nextValue: null`, which is the whole of 1.1.12 on the wire: an ambiguous
 * rule has no proposed value to show, and the rule's description is what the
 * human reads instead.
 */
function detailRow(
  table: LegacySourceTable,
  row: LegacyRuleRow,
  ambiguous: boolean,
): RuleDetailRow {
  const shared = {
    table,
    legacyId: row.legacyId,
    column: row.column,
    previousValue: row.previousValue,
  };

  return ambiguous ? shared : { ...shared, nextValue: row.nextValue };
}
