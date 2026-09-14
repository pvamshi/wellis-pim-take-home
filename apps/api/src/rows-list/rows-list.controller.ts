import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { LegacySourceTable } from '../legacy/legacy-source-table';
import { RowListService, type RowListEntry, type RowState } from '../rules/row-list.service';

/**
 * The rows screen (1.6.1): every row the current filter matches, and how many
 * that is.
 *
 * Not paged. The screen virtualises the list, drawing only the rows on screen,
 * so a page size here would be a second and coarser limit in front of one
 * already doing the job — and one the reader could not scroll past. The rule
 * detail endpoint already takes this line, returning all 340 rows of a rule.
 *
 * `{ rows, total }` rather than a bare array, unlike `RulesListResponse`:
 * `total` is what the heading says, and what tells a reader whether a filter
 * caught anything at all.
 */
export interface RowsListResponse {
  readonly rows: RowListEntry[];
  readonly total: number;
}

/**
 * The three short names a row's `table` filter may name (1.1.14).
 *
 * A `Record` keyed on the union rather than an array of strings, so adding a
 * fourth legacy source fails to compile here instead of silently rejecting
 * every filter against it — the same shape `approve.controller.ts`'s
 * `approvableTables` already uses.
 */
const filterableTables: Record<LegacySourceTable, true> = {
  patient: true,
  intake: true,
  consent: true,
};

/** The three states a row's `state` filter may name (1.6.1). */
const filterableStates: Record<RowState, true> = {
  pending: true,
  clean: true,
  rejected: true,
};

/**
 * Reads the `table` query parameter, or says what is wrong with it.
 *
 * By hand, and deliberately: `tech-stack.md` names no validation library, so
 * class-validator and a global pipe are not introduced for three query
 * parameters — `approve.controller.ts` set that precedent for a request body.
 * Absent is a real answer (no narrowing at all), so only a value that is
 * present and wrong is a 400.
 */
function readTable(value: unknown): LegacySourceTable | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || !Object.hasOwn(filterableTables, value)) {
    throw new BadRequestException('table must be one of "patient", "intake" or "consent"');
  }

  return value as LegacySourceTable;
}

/** Reads the `state` query parameter, or says what is wrong with it. Same shape as `readTable`. */
function readState(value: unknown): RowState | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || !Object.hasOwn(filterableStates, value)) {
    throw new BadRequestException('state must be one of "pending", "clean" or "rejected"');
  }

  return value as RowState;
}

/**
 * The endpoint the rows screen loads (1.6.1, 1.6.2).
 *
 * It delegates and nothing else. The join is `RowListService`'s, which lives
 * in the module that owns the legacy and rule tables (1.1.3) and is exported
 * from it for exactly this — the same division `rules-list/` and
 * `rule-detail/` already keep between an endpoint and the layer it reads.
 *
 * `table` and `state` are read from the query string, not the body: this is a
 * GET, and they are the narrowing 1.6.1 describes ("filtered to one state")
 * plus the table filter. Neither is required — an unfiltered read is the
 * default a caller who names nothing gets.
 */
@Controller('rows')
export class RowsListController {
  constructor(private readonly rows: RowListService) {}

  @Get()
  async list(
    @Query('table') table: unknown,
    @Query('state') state: unknown,
  ): Promise<RowsListResponse> {
    return await this.rows.list({
      table: readTable(table),
      state: readState(state),
    });
  }
}
