import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager, type EntityTarget, type ObjectLiteral } from 'typeorm';
import type { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LegacyConsent } from '../legacy/legacy-consent.entity';
import { LegacyIntake } from '../legacy/legacy-intake.entity';
import { LegacyPatient } from '../legacy/legacy-patient.entity';
import {
  LegacyConsentRule,
  LegacyIntakeRule,
  LegacyPatientRule,
  type LegacyRuleRow,
} from '../legacy/legacy-rule.entity';
import { RuleVersion } from './rule-version.entity';

/** The three tables of one legacy source, and how its rows are addressed. */
interface ApprovalSource {
  /** The short name a finding carries (1.1.14) and a row address names. */
  readonly table: string;
  /** The data table an approved change is written into. */
  readonly data: EntityTarget<ObjectLiteral>;
  /** The rule table whose rows propose those changes. */
  readonly rules: EntityTarget<LegacyRuleRow>;
  /** The property of the data entity holding the legacy id a finding names. */
  readonly legacyIdProperty: string;
}

/**
 * Every legacy source, by the short name a rule row's address carries.
 *
 * Deliberately not `rule-findings.service.ts`'s map, which is private to that
 * file and carries only half of what is needed here: applying a change needs
 * the data table and the property its legacy id lives on, which persisting a
 * finding never does. Two small maps that each say what their own file needs
 * beats one shared map that says more than either.
 *
 * A `Map` keyed on plain strings rather than a `Record<LegacySourceTable, …>`,
 * for the same reason that file gives: the union is a compile-time guarantee
 * and a row address is JSON that crossed a boundary, so the lookup has to be
 * able to miss.
 */
const approvalSources = new Map<string, ApprovalSource>([
  [
    'patient',
    {
      table: 'patient',
      data: LegacyPatient,
      rules: LegacyPatientRule,
      legacyIdProperty: 'legacyPatientId',
    },
  ],
  [
    'intake',
    {
      table: 'intake',
      data: LegacyIntake,
      rules: LegacyIntakeRule,
      legacyIdProperty: 'legacyIntakeId',
    },
  ],
  [
    'consent',
    {
      table: 'consent',
      data: LegacyConsent,
      rules: LegacyConsentRule,
      // A consent line carries no id of its own, so the patient's legacy id is
      // this table's legacy identity — the same column the import keys on.
      legacyIdProperty: 'legacyPatientId',
    },
  ],
]);

/**
 * The full address of one rule row: the four-part primary key of a finding,
 * plus the source whose rule table holds it.
 *
 * The same five values a row on the rules screen is drawn from, which is why
 * the row-level endpoint takes them and nothing else. There is no surrogate id
 * to pass instead — a finding's address *is* its key.
 */
export interface RuleRowAddress {
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
 * A value a human supplied for a finding its rule proposed none for (1.1.12),
 * and the note saying why it is that value (1.2.13). The note is kept as the
 * finding's reason.
 */
export interface SuppliedValue {
  readonly value: string;
  /** Why it is that value, when the human wrote one. Optional — the rule's description already says what was wrong. */
  readonly note: string | null;
}

/**
 * What one press of Approve all on a row did (1.6.4).
 *
 * `table` and `legacyId` echo the address, the way `RuleApprovalReport` echoes
 * `ruleId`: there is no single `ruleId` here, because this press crosses every
 * rule the row has a finding from.
 */
export interface RowApproveAllReport {
  /** `patient`, `intake` or `consent` (1.1.14). */
  readonly table: string;
  readonly legacyId: string;
  /** Rule rows moved from pending to approved — the ones that proposed a value. */
  readonly approved: number;
  /**
   * Legacy data rows written. It can exceed `approved` for the same reason
   * `RuleApprovalReport.updated` can: two legacy rows may share one legacy id
   * (1.0.3).
   */
  readonly updated: number;
  /**
   * Pending findings this press could not act on because the rule behind them
   * is ambiguous and proposed no value (1.1.12) — left pending, exactly as
   * 1.6.4 asks, and counted here so the press never looks like it finished a
   * row it did not.
   */
  readonly skipped: number;
}

/** What one approve did. Returned by both levels, because both apply changes. */
export interface RuleApprovalReport {
  readonly ruleId: string;
  /**
   * The version whose rows were approved. Null only when a rule-level press
   * found no active version to act on, because then no version was chosen.
   */
  readonly version: number | null;
  /** Rule rows moved from pending to approved. */
  readonly approved: number;
  /**
   * Legacy data rows written. It can exceed `approved`: a finding addresses a
   * legacy id and two data rows may share one (1.0.3), in which case the one
   * rule row writes the column on both.
   */
  readonly updated: number;
}

/** One rule row, with everything applying it needs already resolved. */
interface PreparedRow {
  readonly row: LegacyRuleRow;
  /** The data entity's column that the finding's `column` name resolved to. */
  readonly column: ColumnMetadata;
  /** How many legacy data rows carry this finding's legacy id. Never zero. */
  readonly matches: number;
}

/** One source's rule rows, validated and ready to write. */
interface PreparedSource {
  readonly source: ApprovalSource;
  readonly rows: PreparedRow[];
}

/** One rule row's address, for a message a human has to act on. */
function describe(source: ApprovalSource, row: LegacyRuleRow): string {
  return `${source.table} ${row.legacyId} / rule ${row.ruleId} version ${row.version} / column "${row.column}"`;
}

/**
 * The data entity's column a finding's `column` names.
 *
 * A finding carries a database column name — `full_name`, `legacy_patient_id`,
 * the names the export and the entities use — so it is matched on
 * `databaseName` and translated to the property the ORM writes through. Two
 * things follow from resolving it rather than interpolating it: a rule-authored
 * string never reaches the SQL, and a name that resolves to nothing fails the
 * call instead of quietly updating no column.
 */
function resolveColumn(
  manager: EntityManager,
  source: ApprovalSource,
  row: LegacyRuleRow,
): ColumnMetadata {
  const resolved = manager
    .getRepository(source.data)
    .metadata.columns.find((candidate) => candidate.databaseName === row.column);

  if (resolved === undefined) {
    throw new Error(
      `cannot apply ${describe(source, row)}: legacy ${source.table} has no such column`,
    );
  }

  return resolved;
}

/**
 * How many rows of the legacy data table carry each of the given legacy ids.
 *
 * One query for the whole set, not one per finding: a rule that found 340 rows
 * is checked in the same statement its first row is. Only the id column is
 * selected — the whole row is never needed, and `raw_data` on 340 patients is a
 * lot of text to read in order to count them.
 *
 * The count, not merely the presence, because it is what `updated` reports: two
 * legacy rows may share one legacy id (1.0.3), and one finding against that id
 * writes the column on both.
 */
async function countLegacyRows(
  manager: EntityManager,
  source: ApprovalSource,
  legacyIds: Set<string>,
): Promise<Map<string, number>> {
  const found = await manager
    .getRepository(source.data)
    .createQueryBuilder('row')
    .select(`row.${source.legacyIdProperty}`, 'legacyId')
    .where(`row.${source.legacyIdProperty} IN (:...ids)`, { ids: [...legacyIds] })
    .getRawMany<{ legacyId: string }>();

  const counts = new Map<string, number>();

  for (const row of found) {
    counts.set(row.legacyId, (counts.get(row.legacyId) ?? 0) + 1);
  }

  return counts;
}

/**
 * Validates every rule row of one source and resolves what applying it needs.
 *
 * Nothing here writes. That is the whole point of the split: an approve
 * validates every row it was asked for — across all three sources — before it
 * issues a single update, so a finding that cannot be applied fails the call
 * rather than leaving the ones before it applied and the ones after it not.
 *
 * The three ways a row fails are the three things a rule row asserts and this
 * layer cannot take on trust: that there is a value to write, that the column
 * it names exists, and that the legacy row it names is there.
 */
async function prepare(
  manager: EntityManager,
  source: ApprovalSource,
  rows: LegacyRuleRow[],
): Promise<PreparedSource> {
  const legacyIds = new Set<string>();

  const resolved = rows.map((row) => {
    if (row.nextValue === null) {
      // What an ambiguous rule produces (1.1.12): a problem it cannot fix.
      // Writing the null would erase the previous value the screen is showing
      // the human (1.2.3) with no undo to recover it (1.2.11, deferred D2).
      throw new Error(`cannot apply ${describe(source, row)}: it proposes no value`);
    }

    legacyIds.add(row.legacyId);

    return { row, column: resolveColumn(manager, source, row) };
  });

  const counts = await countLegacyRows(manager, source, legacyIds);

  return {
    source,
    rows: resolved.map(({ row, column }) => {
      const matches = counts.get(row.legacyId) ?? 0;

      if (matches === 0) {
        throw new Error(
          `cannot apply ${describe(source, row)}: legacy ${source.table} holds no row with that legacy id`,
        );
      }

      return { row, column, matches };
    }),
  };
}

/**
 * Writes one source's prepared findings into its legacy data table, and reports
 * how many data rows that wrote.
 *
 * One parameterised statement per rule row. A finding names a legacy id and a
 * column, and that pair is the criteria — so an id two rows share updates both
 * (1.0.3), which is the same reading of "a finding addresses a row, it does not
 * identify one" that the rule tables already commit to.
 *
 * The count comes from `prepare`'s own reading of the data table rather than
 * from `UpdateResult.affected`, which drivers report inconsistently; it is
 * counted inside the same transaction, so nothing can have moved underneath it.
 */
async function applyPrepared(manager: EntityManager, prepared: PreparedSource): Promise<number> {
  let updated = 0;

  for (const { row, column, matches } of prepared.rows) {
    await manager.update(
      prepared.source.data,
      { [prepared.source.legacyIdProperty]: row.legacyId },
      { [column.propertyName]: row.nextValue } as QueryDeepPartialEntity<ObjectLiteral>,
    );

    updated += matches;
  }

  return updated;
}

/**
 * Approve, at both levels (1.2.4).
 *
 * The other half of 1.1.3's sentence: the layer that persists findings is the
 * layer that applies accepted ones, which is why this sits beside
 * `RuleFindingsService` rather than behind the endpoint that calls it. Neither
 * a rule nor the runner has any part in it — a rule writes nothing at all
 * (1.1.2), and what an approved finding does to the data is decided in exactly
 * one place.
 *
 * Four things the code does not say on its own:
 *
 * - **One transaction per call, both levels.** 1.2.5 requires the rule row's
 *   status and the data row's column to land or fail together, and one
 *   transaction around the whole press gives that for free — in both
 *   directions, since the status flip is the later of the two writes and a
 *   failure there has to take the column change back with it. Rule-level is not
 *   one transaction per row: a half-applied rule would leave the screen in a
 *   state nobody pressed for, and the user pressed once.
 * - **A finding that cannot be applied fails the press.** No value to apply, a
 *   column the legacy table does not have, a legacy id matching no row: each
 *   aborts the transaction with nothing written, rather than being skipped with
 *   its rule row marked approved. An approved row that changed nothing would
 *   make the modification log (1.3) describe something that never happened.
 *   None of the three is a caller's mistake, so none is dressed up as one.
 * - **Anything else is a count, not a fault.** A rule with no active version, a
 *   rule id nobody has written, an address no rule table holds, a row that is
 *   no longer pending — every one of them approves nothing, writes nothing and
 *   says so in `approved`. A press only ever moves rows that are still pending,
 *   which is what keeps an approved row from being rewritten (1.2.11) and a
 *   declined row from being revived (1.2.7).
 * - **It does not re-check that the column still holds `previousValue`.** Rules
 *   interacting with one another is out of scope (`deferred.md` D3) and the
 *   operator is one of us (1.2.12), so that check would be a guard no
 *   requirement asks for.
 *
 * The rule row is the modification log (1.3). It already carries the rule, the
 * version, the column, the previous value and the next value; this service adds
 * the only thing missing — that it happened — in the same transaction as the
 * change it describes.
 */
@Injectable()
export class RuleApprovalsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Approves every pending row of a rule's active version, across all three
   * source tables (1.2.4, first scenario).
   *
   * Takes only what is still pending: rows already approved keep their status
   * and are not re-applied (1.2.4, third scenario), and declined rows are left
   * declined (1.2.7). The active version is the one the rules screen shows
   * (1.2.1), so the press clears exactly what the user is looking at and the
   * rows left behind record the version that actually proposed the change.
   */
  async approveRule(ruleId: string): Promise<RuleApprovalReport> {
    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const active = await manager
        .getRepository(RuleVersion)
        .findOne({ where: { ruleId, status: 'active' } });

      if (active === null) {
        // Either the rule was declined and is waiting on the revision workflow
        // (1.2.6, 1.5.1), or nobody has ever written it. Both are a press with
        // nothing to act on, and neither is a reason to write anything.
        return { ruleId, version: null, approved: 0, updated: 0 };
      }

      const version = active.version;
      const prepared: PreparedSource[] = [];

      for (const source of approvalSources.values()) {
        const rows = await manager.getRepository(source.rules).find({
          where: { ruleId, version, status: 'pending' },
          order: { legacyId: 'ASC', column: 'ASC' },
        });

        if (rows.length > 0) {
          prepared.push(await prepare(manager, source, rows));
        }
      }

      let approved = 0;
      let updated = 0;

      for (const entry of prepared) {
        updated += await applyPrepared(manager, entry);
        // One statement for the source's whole pending set, and it names the
        // same rows `prepare` validated: the status filter is what keeps an
        // approved or declined row out of it.
        await manager.update(
          entry.source.rules,
          { ruleId, version, status: 'pending' },
          { status: 'approved' },
        );
        approved += entry.rows.length;
      }

      return { ruleId, version, approved, updated };
    });
  }

  /**
   * Approves one rule row, addressed by its primary key (1.2.4, second
   * scenario).
   *
   * Only that row moves; the rule's other rows stay pending and approvable.
   * Every column the version proposes on that row moves with it: a fix may span
   * columns, and those are one atom (1.1.4), never half-applied — for a rule
   * that proposes one column, that is the named finding alone. There is no
   * check that the named version
   * is the active one — the caller named the version, and rule-level approve is
   * the one that has to choose between them.
   *
   * `value` is the human's own answer to a finding the rule could not answer
   * (1.1.12). An ambiguous rule reports what is wrong with a row and proposes
   * nothing, so there was previously no way to settle such a row except to
   * decline it — the screen could show a bad date of birth and offer no way to
   * put the right one in. A value supplied here becomes the row's proposal and
   * is then applied down exactly the same path as a rule's own, so the write,
   * the transaction and the modification log (1.3) are the ones that already
   * exist.
   *
   * It is accepted **only** for a row that proposes nothing. Letting a value
   * override what a rule proposed would make the rule row a record of something
   * other than what the rule said, which the whole engine is built on not doing
   * — the way to disagree with a proposal is the cross, and the way to change
   * one is a new version of the rule (1.1.8, 1.2.8).
   *
   * The note that comes with a supplied value is kept as the finding's reason,
   * so the row's log says why a value no rule proposed was written (1.2.13).
   */
  async approveRow(address: RuleRowAddress, supplied?: SuppliedValue): Promise<RuleApprovalReport> {
    const { table, legacyId, ruleId, version, column } = address;

    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const nothing = { ruleId, version, approved: 0, updated: 0 };
      const source = approvalSources.get(table);

      if (source === undefined) {
        return nothing;
      }

      // Pending is part of the lookup, not a check after it: a row that is
      // already approved (1.2.11) or declined (1.2.7) is settled, and the press
      // simply finds nothing of its own to do.
      const atom = await manager.getRepository(source.rules).find({
        where: { legacyId, ruleId, version, status: 'pending' },
        order: { column: 'ASC' },
      });
      const row = atom.find((candidate) => candidate.column === column);

      if (row === undefined) {
        return nothing;
      }

      if (supplied !== undefined) {
        if (atom.length > 1) {
          throw new Error(
            `cannot supply one value for ${describe(source, row)}: the fix spans ${atom.length} columns`,
          );
        }

        if (row.nextValue !== null) {
          throw new Error(
            `cannot supply a value for ${describe(source, row)}: the rule already proposes one`,
          );
        }

        row.nextValue = supplied.value;
      }

      const updated = await applyPrepared(manager, await prepare(manager, source, atom));

      await manager.update(
        source.rules,
        { legacyId, ruleId, version, status: 'pending' },
        // The supplied value is written back to the row as well as into the
        // data. Without it the finding would stay a null proposal that somehow
        // got approved, and the modification log would have nothing to print
        // for what was written. An ambiguous rule's rows are the only ones this
        // can happen to, which is what says a human typed it.
        {
          status: 'approved',
          ...(supplied === undefined
            ? {}
            : {
                nextValue: supplied.value,
                ...(supplied.note === null ? {} : { reason: supplied.note }),
              }),
        },
      );

      return { ruleId, version, approved: atom.length, updated };
    });
  }

  /**
   * Approves every pending finding on one row, across every rule that made
   * one — the row-wide tick (1.6.4). It is exactly the row-level tick
   * (1.2.4/`approveRow`) pressed on every finding of that row, in one
   * transaction, and it reuses that same apply path rather than
   * re-implementing it: this method's whole job is to find the pending rows
   * and split them, not to decide how one of them is applied.
   *
   * No `ruleId` and no `version` in the address, unlike `approveRow`: this
   * press is not scoped to one rule, and a row's own findings may come from
   * several rules and, within one rule, several versions (`RowDetailService`
   * applies no version filter for the same reason). Every pending row of the
   * one source `table` names is a candidate.
   *
   * Ambiguous findings (`nextValue === null`, 1.1.12) are filtered out before
   * `prepare` ever sees them, rather than being passed in and having its
   * throw caught: that throw means "a data-integrity fault", the same meaning
   * it carries everywhere else in this file, and turning it into "skip this
   * one" here would make it mean two different things depending on which
   * caller triggered it. They are left pending and counted into `skipped`,
   * never written and never flipped to any other status.
   *
   * The rows that do propose a value are validated by the same `prepare` and
   * written by the same `applyPrepared` that `approveRule` and `approveRow`
   * already use, and each is then flipped to `approved` by its own primary
   * key — not by one blanket `UPDATE … WHERE legacy_id = ?`, because that
   * would also catch the ambiguous rows this press must leave untouched.
   *
   * An unknown `table`, or a row with nothing pending, approves nothing and
   * says so with every count at zero — the same "count, not a fault" line
   * every other press in this file draws.
   */
  async approveAllOnRow(table: string, legacyId: string): Promise<RowApproveAllReport> {
    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const nothing: RowApproveAllReport = { table, legacyId, approved: 0, updated: 0, skipped: 0 };
      const source = approvalSources.get(table);

      if (source === undefined) {
        return nothing;
      }

      const rows = await manager.getRepository(source.rules).find({
        where: { legacyId, status: 'pending' },
        order: { ruleId: 'ASC', version: 'ASC', column: 'ASC' },
      });

      if (rows.length === 0) {
        return nothing;
      }

      const proposing = rows.filter((row) => row.nextValue !== null);
      const skipped = rows.length - proposing.length;

      if (proposing.length === 0) {
        return { table, legacyId, approved: 0, updated: 0, skipped };
      }

      const prepared = await prepare(manager, source, proposing);
      const updated = await applyPrepared(manager, prepared);

      for (const { row } of prepared.rows) {
        await manager.update(
          source.rules,
          { legacyId: row.legacyId, ruleId: row.ruleId, version: row.version, column: row.column, status: 'pending' },
          { status: 'approved' },
        );
      }

      return { table, legacyId, approved: prepared.rows.length, updated, skipped };
    });
  }
}
