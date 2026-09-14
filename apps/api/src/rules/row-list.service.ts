import { Injectable } from '@nestjs/common';
import { DataSource, type EntityTarget, type ObjectLiteral } from 'typeorm';
import { LegacyConsent } from '../legacy/legacy-consent.entity';
import { LegacyIntake } from '../legacy/legacy-intake.entity';
import { LegacyPatient } from '../legacy/legacy-patient.entity';
import {
  LegacyConsentRule,
  LegacyIntakeRule,
  LegacyPatientRule,
  type LegacyRuleRow,
} from '../legacy/legacy-rule.entity';
import type { LegacySourceTable } from '../legacy/legacy-source-table';
import { RowRejection } from '../rows/row-rejection.entity';

/** The three states a row can be in (1.6.1). */
export type RowState = 'pending' | 'clean' | 'rejected';

/**
 * One line of the rows screen (1.6.1): a legacy row and the state it is in.
 *
 * Three fields and no more. The screen's other work — what is waiting on a
 * row (1.6.3), approving or declining it (1.6.4, 1.6.5), rejecting it (1.6.6)
 * — reads the address `(table, legacyId)` off this line and acts through
 * endpoints of its own; nothing about *how* a row got its state belongs on
 * the line that only reports it.
 */
export interface RowListEntry {
  /** Which legacy source the row is in. */
  readonly table: LegacySourceTable;
  /** Theirs, and not unique (1.0.3) — this line names a row, not a person. */
  readonly legacyId: string;
  readonly state: RowState;
}

/** What the screen may narrow the list to (1.6.1). Both narrowings are optional. */
export interface RowListFilter {
  readonly table?: LegacySourceTable;
  readonly state?: RowState;
  /** 1-based. Defaults to the first page. */
  readonly page?: number;
}

/**
 * A page of the rows screen: the rows themselves, and the filtered total.
 *
 * `total` is the count the current filter matches, not the grand count across
 * every state and table — what a `Pagination` control needs to compute how
 * many pages there are, not how big the whole dataset is.
 */
export interface RowListResult {
  readonly rows: RowListEntry[];
  readonly total: number;
}

/**
 * Fixed rather than caller-adjustable: there is no data-grid or virtualization
 * package in this stack (tech-stack), and a plain Mantine `<Table>` needs a
 * small, fixed page size to stay responsive.
 */
export const ROWS_PAGE_SIZE = 50;

/** The three tables a legacy row can come from, and how each is read. */
interface RowSource {
  readonly table: LegacySourceTable;
  /** The legacy data table — the "every row" universe (1.6.1), not a rule table. */
  readonly data: EntityTarget<ObjectLiteral>;
  /** The property of the data entity holding the legacy id (1.0.3, non-unique). */
  readonly legacyIdProperty: string;
  /** The rule table findings against this source land in (1.1.14). */
  readonly rules: EntityTarget<LegacyRuleRow>;
}

/**
 * Every legacy source, in the order the screen lists them.
 *
 * A plain array, not a keyed map: the one lookup this service does is "the
 * caller named one table", which a `.find` over three entries answers as
 * cheaply as a map would, and every other read here always visits all three.
 */
const rowSources: readonly RowSource[] = [
  {
    table: 'patient',
    data: LegacyPatient,
    legacyIdProperty: 'legacyPatientId',
    rules: LegacyPatientRule,
  },
  {
    table: 'intake',
    data: LegacyIntake,
    legacyIdProperty: 'legacyIntakeId',
    rules: LegacyIntakeRule,
  },
  {
    table: 'consent',
    data: LegacyConsent,
    // A consent line carries no id of its own, so the patient's legacy id is
    // this table's legacy identity — the same column `rule-approvals.service.ts`
    // reads for the same reason.
    legacyIdProperty: 'legacyPatientId',
    rules: LegacyConsentRule,
  },
];

/**
 * The rows screen's list (1.6.1, 1.6.2): every legacy row, with its state.
 *
 * It lives here, beside `RuleListService` and `RuleDetailService`, because it
 * is the same shape of thing they are — a read-only aggregator over the
 * legacy and rule tables — and 1.1.3 puts the layer that owns those tables
 * here. The endpoint that serves it is a module of its own, exactly as the
 * rules screen's is.
 *
 * Four things the code does not say on its own:
 *
 * - **The universe is the legacy data tables, not the rule tables.** A row
 *   with zero findings is still a row (1.6.1's "every one of them"), and a
 *   rule table only ever holds rows that caught something.
 * - **Rejection wins over pending, which wins over clean.** 1.6.2's third
 *   scenario is explicit that a row "stays rejected however its findings
 *   later settle", so rejection is checked first and short-circuits the rest.
 * - **Pending and clean are never stored; only rejection is read from a
 *   table.** 1.6.2 draws that line directly: a stored "clean" would go stale
 *   the moment a later rule run found something new.
 * - **Everything is built in memory, once per call, before paging.** Three
 *   small per-source queries (the legacy ids, the pending ids, the rejected
 *   ids) rather than a per-source `EXISTS` pushed into SQL. 2466 patients is
 *   the real size (1.6.1) — comfortably held as an array of strings — and it
 *   keeps every table and column reference typed through entities, the same
 *   trade `RuleListService`/`RuleDetailService` already take over raw SQL
 *   against three different rule tables. It stops being the right call only
 *   if the legacy export grows by orders of magnitude, which nothing in scope
 *   asks for.
 */
@Injectable()
export class RowListService {
  constructor(private readonly dataSource: DataSource) {}

  /** A page of the rows screen (1.6.1), narrowed by whatever filter was given. */
  async list(filter: RowListFilter = {}): Promise<RowListResult> {
    const sources = filter.table
      ? rowSources.filter((source) => source.table === filter.table)
      : rowSources;

    const entries: RowListEntry[] = [];

    for (const source of sources) {
      const [legacyIds, pendingIds, rejectedIds] = await Promise.all([
        this.distinctIds(source.data, source.legacyIdProperty),
        this.distinctPendingIds(source.rules),
        this.rejectedIds(source.table),
      ]);

      for (const legacyId of legacyIds) {
        entries.push({
          table: source.table,
          legacyId,
          state: rejectedIds.has(legacyId)
            ? 'rejected'
            : pendingIds.has(legacyId)
              ? 'pending'
              : 'clean',
        });
      }
    }

    const filtered =
      filter.state === undefined
        ? entries
        : entries.filter((entry) => entry.state === filter.state);

    // Stable order, so a page is the same rows on a second load: 1.6.1 says
    // nothing about ordering, and an order that were the database's rather
    // than the screen's could reshuffle a page out from under a caller who
    // paged past the first.
    filtered.sort(
      (left, right) =>
        left.table.localeCompare(right.table) || left.legacyId.localeCompare(right.legacyId),
    );

    const total = filtered.length;
    const page = filter.page ?? 1;
    const start = (page - 1) * ROWS_PAGE_SIZE;

    return { rows: filtered.slice(start, start + ROWS_PAGE_SIZE), total };
  }

  /** Every distinct legacy id the source's data table carries (1.0.3: not unique). */
  private async distinctIds(
    entity: EntityTarget<ObjectLiteral>,
    legacyIdProperty: string,
  ): Promise<string[]> {
    const rows = await this.dataSource
      .getRepository(entity)
      .createQueryBuilder('row')
      .select(`row.${legacyIdProperty}`, 'legacyId')
      .distinct(true)
      .getRawMany<{ legacyId: string }>();

    return rows.map((row) => row.legacyId);
  }

  /** Every distinct legacy id with at least one pending finding in this rule table. */
  private async distinctPendingIds(entity: EntityTarget<LegacyRuleRow>): Promise<Set<string>> {
    const rows = await this.dataSource
      .getRepository(entity)
      .createQueryBuilder('finding')
      .select('finding.legacyId', 'legacyId')
      .distinct(true)
      .where('finding.status = :status', { status: 'pending' })
      .getRawMany<{ legacyId: string }>();

    return new Set(rows.map((row) => row.legacyId));
  }

  /** Every legacy id rejected against this source (1.6.2, 1.6.6). */
  private async rejectedIds(table: LegacySourceTable): Promise<Set<string>> {
    const rows = await this.dataSource
      .getRepository(RowRejection)
      .createQueryBuilder('rejection')
      .select('rejection.legacyId', 'legacyId')
      .where('rejection.table = :table', { table })
      .getRawMany<{ legacyId: string }>();

    return new Set(rows.map((row) => row.legacyId));
  }
}
