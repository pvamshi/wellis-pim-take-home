import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { LegacySourceTable } from '../legacy/legacy-source-table';
import { RowListService, type RowListEntry, type RowState } from '../rules/row-list.service';

/**
 * A page of the rows screen (1.6.1): the rows themselves, and the count the
 * current filter matches.
 *
 * `{ rows, total }` rather than a bare array, unlike `RulesListResponse`: that
 * list is bounded by the rule catalogue and needs no page count, this one is
 * bounded by the legacy export (2466 patients, the real size) and is paged, so
 * the frontend's `Pagination` needs `total` to compute how many pages there
 * are.
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
 * Reads the `page` query parameter, or says what is wrong with it.
 *
 * Absent means the first page — 1.6.1 says nothing about a caller who never
 * asked for one — and anything present that is not a positive integer is a
 * 400. An out-of-range page (past the last one the filter has) is not an
 * error: it is well-formed and answers an empty `rows` with the correct
 * `total`, the same "empty result is a state, not a failure" line the rest of
 * this screen draws.
 */
function readPage(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new BadRequestException('page must be a positive integer');
  }

  return Number(value);
}

/**
 * The endpoint the rows screen loads (1.6.1, 1.6.2).
 *
 * It delegates and nothing else. The join is `RowListService`'s, which lives
 * in the module that owns the legacy and rule tables (1.1.3) and is exported
 * from it for exactly this — the same division `rules-list/` and
 * `rule-detail/` already keep between an endpoint and the layer it reads.
 *
 * `table`, `state` and `page` are read from the query string, not the body:
 * this is a GET, and the same three narrowings 1.6.1 describes ("filtered to
 * one state") plus the table filter this task's own instructions ask for.
 * None is required — an unfiltered, first-page read is the default a caller
 * who names nothing gets.
 */
@Controller('rows')
export class RowsListController {
  constructor(private readonly rows: RowListService) {}

  @Get()
  async list(
    @Query('table') table: unknown,
    @Query('state') state: unknown,
    @Query('page') page: unknown,
  ): Promise<RowsListResponse> {
    return await this.rows.list({
      table: readTable(table),
      state: readState(state),
      page: readPage(page),
    });
  }
}
