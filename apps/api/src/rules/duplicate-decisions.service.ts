import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { Duplicate, type DuplicateStatus } from '../duplicates/duplicate.entity';
import { RowRejectionsService } from '../rows/row-rejections.service';

/** A press that found no pending link with this id. */
export interface DuplicateDecisionNotFound {
  readonly outcome: 'not-found';
}

/** A press against a link that is no longer pending (1.7.3: both end states are final). */
export interface DuplicateDecisionNotPending {
  readonly outcome: 'not-pending';
  readonly status: DuplicateStatus;
}

/** What confirming a link did (1.7.5). */
export interface DuplicateConfirmReport {
  readonly outcome: 'confirmed';
  readonly id: string;
  readonly status: 'confirmed';
  /** True only for a patient link, where confirming also rejects X (1.7.5). */
  readonly rejected: boolean;
}

/** What dismissing a link did (1.7.6). */
export interface DuplicateDismissReport {
  readonly outcome: 'dismissed';
  readonly id: string;
  readonly status: 'dismissed';
}

export type DuplicateConfirmResult =
  | DuplicateConfirmReport
  | DuplicateDecisionNotFound
  | DuplicateDecisionNotPending;

export type DuplicateDismissResult =
  | DuplicateDismissReport
  | DuplicateDecisionNotFound
  | DuplicateDecisionNotPending;

/**
 * The reason auto-written onto X when confirming a patient link rejects it
 * (1.7.5): names Y's legacy id and the rule, as the scenario itself asks.
 * Overwritten by a second confirm exactly the way `RowRejectionsService`
 * already treats a second press on an already-rejected row — there is no
 * template elsewhere in this codebase for a system-generated reason to
 * follow, since every other stored reason is human-typed.
 */
function confirmReason(canonicalLegacyId: string, ruleId: string): string {
  return `Duplicate of ${canonicalLegacyId} (rule ${ruleId})`;
}

/**
 * Confirm and dismiss (1.7.5, 1.7.6): the terminal presses on a pending link.
 *
 * Lives beside `DuplicateListService`/`DuplicateDetailService` for the same
 * reason they do — `duplicate` is a table this layer owns (1.1.3) — and beside
 * `RuleFindingsService`, the only other writer of that table, so a link's
 * only two write paths sit next to each other.
 *
 * Neither method throws an HTTP exception: services throw none. Each reads the
 * link first, then reports `not-found` or `not-pending` as a value, the same
 * "count, not a fault" line `RuleApprovalsService` draws for a press with
 * nothing to act on. Whether either is a 404 or a 409 is the controller's
 * choice, not this service's — 409 is a genuinely new kind of outcome here:
 * 1.7.3's statuses are final, so pressing confirm or dismiss twice deserves
 * more than the existing silent-zero convention's "nothing moved".
 */
@Injectable()
export class DuplicateDecisionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rejections: RowRejectionsService,
  ) {}

  /**
   * Confirms a pending link (1.7.5). A patient link additionally rejects X, in
   * the same transaction, through `RowRejectionsService.reject` handed this
   * transaction's own manager — so the status flip and the rejection land or
   * fail together. An intake or consent link never rejects: `duplicateLegacyId`
   * and `canonicalLegacyId` there are the same legacy id, and rejecting it
   * would take both rows (1.7.5).
   */
  async confirm(id: string): Promise<DuplicateConfirmResult> {
    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const repository = manager.getRepository(Duplicate);
      const link = await repository.findOne({ where: { id } });

      if (link === null) {
        return { outcome: 'not-found' };
      }

      if (link.status !== 'pending') {
        return { outcome: 'not-pending', status: link.status };
      }

      // Pending in the WHERE clause, the same guard every other press in this
      // codebase flips a status with.
      await repository.update({ id, status: 'pending' }, { status: 'confirmed' });

      const rejected = link.sourceTable === 'patient';

      if (rejected) {
        await this.rejections.reject(
          'patient',
          link.duplicateLegacyId,
          confirmReason(link.canonicalLegacyId, link.ruleId),
          manager,
        );
      }

      return { outcome: 'confirmed', id, status: 'confirmed', rejected };
    });
  }

  /** Dismisses a pending link (1.7.6). Neither row changes; never recorded again (1.7.2). */
  async dismiss(id: string): Promise<DuplicateDismissResult> {
    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const repository = manager.getRepository(Duplicate);
      const link = await repository.findOne({ where: { id } });

      if (link === null) {
        return { outcome: 'not-found' };
      }

      if (link.status !== 'pending') {
        return { outcome: 'not-pending', status: link.status };
      }

      await repository.update({ id, status: 'pending' }, { status: 'dismissed' });

      return { outcome: 'dismissed', id, status: 'dismissed' };
    });
  }
}
