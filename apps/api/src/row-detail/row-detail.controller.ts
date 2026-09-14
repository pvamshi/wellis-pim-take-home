import { BadRequestException, Controller, Get, NotFoundException, Param } from '@nestjs/common';
import type { LegacySourceTable } from '../legacy/legacy-source-table';
import { RowDetailService, type RowDetail } from '../rules/row-detail.service';

/**
 * One row expanded (1.6.3): its own column values, and its findings grouped
 * by the rule that made them.
 *
 * The service's shape unchanged, named here so the screen and its tests have
 * one import for it — exactly what `RuleDetailResponse` already does for the
 * rules screen's detail.
 */
export type RowDetailResponse = RowDetail;

/**
 * The three short names the `:table` segment may name (1.1.14).
 *
 * Restated here rather than imported from `rows-list.controller.ts`'s
 * `filterableTables` — that file's own comment already prefers small
 * per-file restatement of this tiny map over cross-file sharing, the same
 * precedent `approve.controller.ts`'s `approvableTables` set.
 */
const detailableTables: Record<LegacySourceTable, true> = {
  patient: true,
  intake: true,
  consent: true,
};

/**
 * Reads the `:table` path segment, or says what is wrong with it.
 *
 * Unlike `rows-list.controller.ts`'s `readTable`, absent is never a value
 * here: a path segment is always present, so any string outside the three
 * legal names is unconditionally a 400.
 */
function readTable(value: string): LegacySourceTable {
  if (!Object.hasOwn(detailableTables, value)) {
    throw new BadRequestException('table must be one of "patient", "intake" or "consent"');
  }

  return value as LegacySourceTable;
}

/**
 * The endpoint behind expanding a row (1.6.3).
 *
 * It delegates and nothing else. The read is `RowDetailService`'s, which
 * lives in the module that owns the legacy and rule tables (1.1.3) and is
 * exported from it for exactly this — the same division `rule-detail/` keeps
 * for the rules screen's own expanded view.
 *
 * It shares the `rows` prefix with `rows-list/`, exactly as `rule-detail/`
 * shares `rules` with `rules-list/`: `GET /rows/:table/:legacyId` cannot
 * shadow `GET /rows`, and no other route under this prefix is a two-segment
 * GET.
 *
 * The 404 is here, not in the service: `RowDetailService.detail` answers null
 * for a legacy id the data table has never seen, and HTTP status is the
 * controller's to choose, the same line `RuleDetailController` already
 * draws.
 */
@Controller('rows')
export class RowDetailController {
  constructor(private readonly rows: RowDetailService) {}

  @Get(':table/:legacyId')
  async detail(
    @Param('table') table: string,
    @Param('legacyId') legacyId: string,
  ): Promise<RowDetailResponse> {
    const detail = await this.rows.detail(readTable(table), legacyId);

    if (detail === null) {
      throw new NotFoundException(`there is no ${table} row "${legacyId}"`);
    }

    return detail;
  }
}
