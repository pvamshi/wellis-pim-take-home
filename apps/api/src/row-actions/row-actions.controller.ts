import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { LegacySourceTable } from '../legacy/legacy-source-table';
import { RowRejectionsService, type RowRejectionReport } from '../rows/row-rejections.service';
import {
  RuleApprovalsService,
  type RowApproveAllReport,
} from '../rules/rule-approvals.service';
import { RuleRowDeclinesService, type RowDeclineAllReport } from '../rules/rule-row-declines.service';

/** What Approve all did to one row (1.6.4). */
export type RowApproveAllResponse = RowApproveAllReport;

/** What Decline all did to one row (1.6.5). */
export type RowDeclineAllResponse = RowDeclineAllReport;

/** What a reject or an unreject press left the row as (1.6.6). */
export type RowRejectionResponse = RowRejectionReport;

/**
 * The three short names the `:table` segment may name (1.1.14).
 *
 * Restated here rather than imported from `row-detail.controller.ts`'s
 * `detailableTables` or `rows-list.controller.ts`'s `filterableTables` — both
 * files already prefer small per-file restatement of this tiny map over
 * cross-file sharing, and this is the third route family under `rows` to make
 * the same choice.
 */
const rowActionTables: Record<LegacySourceTable, true> = {
  patient: true,
  intake: true,
  consent: true,
};

/**
 * Reads the `:table` path segment, or says what is wrong with it.
 *
 * Unlike `rows-list.controller.ts`'s `readTable`, absent is never a value
 * here: a path segment is always present, so any string outside the three
 * legal names is unconditionally a 400 — the same reading
 * `row-detail.controller.ts`'s `readTable` already gives for the same kind of
 * segment.
 */
function readTable(value: string): LegacySourceTable {
  if (!Object.hasOwn(rowActionTables, value)) {
    throw new BadRequestException('table must be one of "patient", "intake" or "consent"');
  }

  return value as LegacySourceTable;
}

/**
 * Reads the reason out of a request body, or says what is wrong with it.
 *
 * A deliberate copy of `decline.controller.ts`'s `readReason` rather than a
 * shared parser, for the reason that file already gives: the codebase prefers
 * a file-local parser over premature sharing between routes owned by
 * different tasks.
 *
 * No body at all, `{}` and `{ reason: null }` are all the same request: a
 * press with no reason. A `reason` that is present and is not a string is the
 * caller's mistake and nothing else — a 400.
 */
function readReason(body: unknown): string | null {
  if (body === undefined || body === null) {
    return null;
  }

  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('a body of { reason } is required, or no body at all');
  }

  const { reason } = body as Record<string, unknown>;

  if (reason === undefined || reason === null) {
    return null;
  }

  if (typeof reason !== 'string') {
    throw new BadRequestException('reason must be a string');
  }

  return reason;
}

/**
 * The four row-wide presses (1.6.4, 1.6.5, 1.6.6): Approve all, Decline all,
 * Reject and Un-reject.
 *
 * It composes and nothing else. Approve all and decline all are
 * `RuleApprovalsService.approveAllOnRow` and
 * `RuleRowDeclinesService.declineAllOnRow` — new methods on the exact two
 * services that already own the single-finding press each is the row-wide
 * form of, so this controller reuses their apply path rather than
 * re-implementing it. Reject and un-reject are `RowRejectionsService`, the
 * one write path onto `row_rejection` (1.6.2, 1.6.6).
 *
 * A sibling of `rows-list/` and `row-detail/`, not a fourth method added to
 * either: neither of those controllers' services can reach the rule tables or
 * `row_rejection` this one writes to, and — the structural reason, not merely
 * a style one — `ApproveController`/`DeclineController` are pinned to the
 * `rules` prefix by their own `@Controller` decorator, so there is no way to
 * add a `/rows/...` route to them regardless of how the write logic were
 * organised. This controller shares the `rows` prefix those two already keep
 * for `GET /rows` and `GET /rows/:table/:legacyId`: none of the four routes
 * below is a bare `GET` or a two-segment `GET`, so nothing here can shadow
 * either.
 *
 * Two things worth being explicit about:
 *
 * - **Approve all and decline all are not each other with a flag.** 1.6.4
 *   skips an ambiguous finding because there is no proposal to apply; 1.6.5
 *   declines it anyway, because the cross needs no proposal to press. That
 *   asymmetry lives in the two services, not here — this controller sends
 *   nothing that distinguishes one finding from another.
 * - **Nothing here checks that the legacy row exists.** All four services
 *   already answer "nothing to act on" as a count or a settled state rather
 *   than a 404 for this exact `(table, legacyId)` shape of address — the same
 *   line the single-finding approve and decline endpoints draw for a screen
 *   that may be a moment stale (1.2.12) — so a fourth check here would be one
 *   this task's own services do not ask for.
 *
 * All four are POST, because all four write, and all four answer 200 rather
 * than Nest's default 201: none creates a resource at a URL, each reports on
 * work it did or a state it left the row in.
 */
@Controller('rows')
export class RowActionsController {
  constructor(
    private readonly approvals: RuleApprovalsService,
    private readonly declines: RuleRowDeclinesService,
    private readonly rejections: RowRejectionsService,
  ) {}

  /**
   * Approve all (1.6.4): every pending finding on this row that proposes a
   * value, applied and written in one transaction. Ambiguous findings are
   * left pending and counted into `skipped`.
   */
  @Post(':table/:legacyId/approve')
  @HttpCode(HttpStatus.OK)
  async approveAll(
    @Param('table') table: string,
    @Param('legacyId') legacyId: string,
  ): Promise<RowApproveAllResponse> {
    return await this.approvals.approveAllOnRow(readTable(table), legacyId);
  }

  /**
   * Decline all (1.6.5): every pending finding on this row, ambiguous ones
   * included, declined forever (1.2.9) with the reason given, if any.
   */
  @Post(':table/:legacyId/decline')
  @HttpCode(HttpStatus.OK)
  async declineAll(
    @Param('table') table: string,
    @Param('legacyId') legacyId: string,
    @Body() body: unknown,
  ): Promise<RowDeclineAllResponse> {
    return await this.declines.declineAllOnRow(readTable(table), legacyId, readReason(body));
  }

  /**
   * Reject (1.6.6): this row is not worth migrating. Reversible — it writes
   * nothing to the legacy data, only to `row_rejection`.
   */
  @Post(':table/:legacyId/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('table') table: string,
    @Param('legacyId') legacyId: string,
    @Body() body: unknown,
  ): Promise<RowRejectionResponse> {
    return await this.rejections.reject(readTable(table), legacyId, readReason(body));
  }

  /**
   * Un-reject (1.6.6): takes a rejection back. No body is read — there is
   * nowhere on `row_rejection` for an "unreject reason" to be kept once the
   * row is deleted.
   */
  @Post(':table/:legacyId/unreject')
  @HttpCode(HttpStatus.OK)
  async unreject(
    @Param('table') table: string,
    @Param('legacyId') legacyId: string,
  ): Promise<RowRejectionResponse> {
    return await this.rejections.unreject(readTable(table), legacyId);
  }
}
