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
import { Patient } from '../patient/patient.entity';
import { RowRejection } from '../rows/row-rejection.entity';

/**
 * The four states a row can be in — 1.6.1's original three, plus B4's
 * `imported` (2.6): "a legacy patient row is imported when `patient.legacy_id`
 * names it." Precedence, per 2.6, is `imported > rejected > pending > clean`.
 */
export type RowState = 'imported' | 'pending' | 'clean' | 'rejected';

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
  /**
   * What the screen titles the row by: the patient's full name on a patient
   * row, null when it has none and on intake and consent rows. A legacy id
   * repeated across rows with different names (1.0.3) carries every name, so
   * the title never picks one of them silently.
   */
  readonly name: string | null;
  readonly state: RowState;
}

/** What the screen may narrow the list to (1.6.1), and which slice it wants. */
export interface RowListFilter {
  readonly table?: LegacySourceTable;
  readonly state?: RowState;
  /** How many rows to skip. Defaults to none. */
  readonly offset?: number;
  /** How many to return. Defaults to `ROWS_DEFAULT_LIMIT`, capped at `ROWS_MAX_LIMIT`. */
  readonly limit?: number;
}

/**
 * One slice of the rows the filter matches, and how many there are in all.
 *
 * A slice rather than everything, because the screen fetches as it scrolls: at
 * 2466 patients the whole set is half a megabyte of JSON that the reader has
 * asked to see twenty rows of.
 *
 * What a slice does **not** save is the work of finding it. The state of a row
 * is derived from its findings (1.6.2), so the whole filtered set has to be
 * built before any window of it can be cut — the slice is the last step, not
 * the first. That is deliberate rather than overlooked: the unfiltered endpoint
 * answers in well under a tenth of a second on the real export, and deriving
 * state in SQL across a union of three sources, with an order stable enough to
 * page against, would be a great deal of machinery bought with no measured
 * gain. What the slice saves is the payload and the parse, which is what grows
 * with the dataset.
 *
 * `total` is the count this filter matches, not the length of this slice: it is
 * what the heading says and what tells the screen whether there is more to
 * fetch.
 */
export interface RowListResult {
  readonly rows: RowListEntry[];
  readonly total: number;
}

/** Rows returned when the caller names no limit. */
export const ROWS_DEFAULT_LIMIT = 100;

/**
 * The most rows one call will return, however large a limit is asked for.
 *
 * A caller asking for everything is the shape this endpoint exists to avoid, so
 * the cap is the endpoint's own and not a suggestion — a limit past it is
 * clamped, not rejected, because asking for more than there is has never been
 * an error here.
 */
export const ROWS_MAX_LIMIT = 500;

/** The three tables a legacy row can come from, and how each is read. */
interface RowSource {
  readonly table: LegacySourceTable;
  /** The legacy data table — the "every row" universe (1.6.1), not a rule table. */
  readonly data: EntityTarget<ObjectLiteral>;
  /** The property of the data entity holding the legacy id (1.0.3, non-unique). */
  readonly legacyIdProperty: string;
  /** The property holding the name a row is titled by, on the one source that has one. */
  readonly nameProperty?: string;
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
    nameProperty: 'fullName',
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
      const [legacyIds, pendingIds, rejectedIds, importedIds, names] = await Promise.all([
        this.distinctIds(source.data, source.legacyIdProperty),
        this.distinctPendingIds(source.rules),
        this.rejectedIds(source.table),
        // Only a legacy patient row is ever imported (2.6) — intake and
        // consent rows "come with their patient" rather than having an
        // imported state of their own.
        source.table === 'patient' ? this.importedLegacyIds() : Promise.resolve(new Set<string>()),
        source.nameProperty === undefined
          ? Promise.resolve(new Map<string, string>())
          : this.namesByLegacyId(source.data, source.legacyIdProperty, source.nameProperty),
      ]);

      for (const legacyId of legacyIds) {
        entries.push({
          table: source.table,
          legacyId,
          name: names.get(legacyId) ?? null,
          state: importedIds.has(legacyId)
            ? 'imported'
            : rejectedIds.has(legacyId)
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

    // Stable order, so the list is the same list on a second load: 1.6.1 says
    // nothing about ordering, and an order that were the database's rather than
    // the screen's could reshuffle under a reader who had scrolled.
    filtered.sort(
      (left, right) =>
        left.table.localeCompare(right.table) || left.legacyId.localeCompare(right.legacyId),
    );

    const offset = filter.offset ?? 0;
    const limit = Math.min(filter.limit ?? ROWS_DEFAULT_LIMIT, ROWS_MAX_LIMIT);

    // An offset past the end is not a fault: it answers no rows and the true
    // total, the same "an empty result is a state, not a failure" line the rest
    // of this screen draws.
    return { rows: filtered.slice(offset, offset + limit), total: filtered.length };
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

  /**
   * Each legacy id's name, from every row carrying that id: trimmed, blanks
   * dropped, distinct, sorted and joined with " / " — one id can be several
   * rows (1.0.3), and they need not agree.
   */
  private async namesByLegacyId(
    entity: EntityTarget<ObjectLiteral>,
    legacyIdProperty: string,
    nameProperty: string,
  ): Promise<Map<string, string>> {
    const rows = await this.dataSource
      .getRepository(entity)
      .createQueryBuilder('row')
      .select(`row.${legacyIdProperty}`, 'legacyId')
      .addSelect(`row.${nameProperty}`, 'name')
      .getRawMany<{ legacyId: string; name: string | null }>();

    const seen = new Map<string, Set<string>>();

    for (const row of rows) {
      const name = row.name?.trim();
      if (!name) continue;

      const names = seen.get(row.legacyId) ?? new Set<string>();
      names.add(name);
      seen.set(row.legacyId, names);
    }

    return new Map(
      [...seen].map(([legacyId, names]) => [legacyId, [...names].sort().join(' / ')]),
    );
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

  /** Every legacy id a `patient` row's `legacy_id` names (2.6) — the derived, never-stored `imported` state. */
  private async importedLegacyIds(): Promise<Set<string>> {
    const rows = await this.dataSource
      .getRepository(Patient)
      .createQueryBuilder('patient')
      .select('patient.legacyId', 'legacyId')
      .where('patient.origin = :origin', { origin: 'legacy' })
      .andWhere('patient.legacy_id IS NOT NULL')
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
