import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { LegacySourceTable } from '../legacy/legacy-source-table';
import { RowRejection } from './row-rejection.entity';

/**
 * The reason as it is stored: trimmed, and null when there is nothing in it.
 *
 * Copied from `rule-versions.service.ts` (and `rule-row-declines.service.ts`
 * beside it), rather than imported: a row's rejection reason is written by yet
 * a third press onto yet a third table, and the one thing that must not differ
 * between any of them is what the stored value means. So the rule is restated
 * where the write is, the same file-local precedent the other two already set.
 */
function storedReason(reason: string | null | undefined): string | null {
  if (typeof reason !== 'string') {
    return null;
  }

  const trimmed = reason.trim();

  return trimmed.length === 0 ? null : trimmed;
}

/**
 * What a reject or an unreject press did (1.6.6): the address, and the row's
 * resulting state.
 *
 * One shape for both presses, and a state rather than a count. Every other
 * report in this codebase counts rows moved, because the write behind it can
 * legitimately find zero to move (a row already settled, an address nobody
 * recognises). `row_rejection` has no such zero case by its own design —
 * "presence of the row is the fact" (`row-rejection.entity.ts`) — so `reject`
 * always ends with the row rejected and `unreject` always ends with it not,
 * and the only useful thing to report is which. It is also what lets a test
 * prove the round trip 1.6.6 asks for by reading the response, rather than by
 * a side query against the table.
 */
export interface RowRejectionReport {
  /** `patient`, `intake` or `consent` (1.1.14). */
  readonly table: LegacySourceTable;
  readonly legacyId: string;
  readonly rejected: boolean;
  /** The reason on record, or null. Always null after `unreject` — the row is gone. */
  readonly reason: string | null;
}

/**
 * The write path onto `row_rejection` (1.6.6): the one column on the rows
 * screen's unit that is stored rather than derived (1.6.2).
 *
 * A service of its own, in `rows/` rather than `rules/`: unlike
 * `RuleApprovalsService.approveAllOnRow` and
 * `RuleRowDeclinesService.declineAllOnRow` (1.6.4, 1.6.5), which act on the
 * rule tables `RulesModule` owns, a reject or an unreject touches only
 * `row_rejection`, which `RowsModule` already owns and whose own entity
 * comment earmarks this exact write path as a later task's to add — this is
 * that task.
 *
 * `table` is typed as `LegacySourceTable` rather than the plain `string`
 * `RuleRowAddress`/`RuleRowDeclineAddress` accept: those two look a caller's
 * table up in a `Map` that simply misses on anything unrecognised, so a wider
 * type costs nothing. This service writes `table` straight into a column with
 * no such lookup to miss against, so a narrower type is what keeps a garbage
 * value from ever reaching the database — the controller is the one place
 * that has to make the value be one of the three before it gets here.
 *
 * Reversible by construction (1.6.6): rejecting writes nothing to the legacy
 * data or to any rule table, so taking it back is a plain delete with nothing
 * to undo.
 *
 * No existence check against the legacy data table on either method — the
 * same line `RuleApprovalsService`/`RuleRowDeclinesService` already draw for
 * approve-all and decline-all: a legacy row is never deleted post-import, so
 * there is no plausible staleness story here that those two presses do not
 * already face for the same (table, legacyId) address.
 */
@Injectable()
export class RowRejectionsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Rejects one row, with the reason the user gave if they gave one (1.6.6).
   *
   * Find-then-insert-or-update inside one transaction, not a bare `.save()`:
   * there is no existing upsert-via-save precedent anywhere in this codebase
   * to build on, and this is the same read-then-write shape
   * `RuleRowDeclinesService.declineRow` already uses for its own pair. A
   * second rejection of an already-rejected row updates the one row in place
   * with whatever reason this press was given — the row's key is
   * `(table, legacyId)`, so there is nowhere else for a second press to land.
   */
  async reject(
    table: LegacySourceTable,
    legacyId: string,
    reason?: string | null,
  ): Promise<RowRejectionReport> {
    const stored = storedReason(reason);

    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const repository = manager.getRepository(RowRejection);
      const existing = await repository.findOne({ where: { table, legacyId } });

      if (existing === null) {
        await repository.insert({ table, legacyId, reason: stored });
      } else {
        await repository.update({ table, legacyId }, { reason: stored });
      }

      return { table, legacyId, rejected: true, reason: stored };
    });
  }

  /**
   * Un-rejects one row (1.6.6): deletes its `row_rejection` row, if it has
   * one.
   *
   * One unconditional delete, no transaction needed — a single statement has
   * nothing else to land or fail alongside. A row that was never rejected
   * deletes nothing and reports exactly the same state a freshly-rejected row
   * would report after this call: not rejected, no reason on record. No
   * reason is accepted here to store or echo: 1.6.6 puts the reason on
   * rejecting, and `row_rejection` has no column to keep an "unreject reason"
   * on once the row is gone — there is nowhere for one to go.
   */
  async unreject(table: LegacySourceTable, legacyId: string): Promise<RowRejectionReport> {
    await this.dataSource.getRepository(RowRejection).delete({ table, legacyId });

    return { table, legacyId, rejected: false, reason: null };
  }
}
