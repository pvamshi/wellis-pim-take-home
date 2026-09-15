import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { LegacySourceTable } from '../legacy/legacy-source-table';
import { RowListService, type RowListEntry, type RowState } from '../rules/row-list.service';

/**
 * The rows screen (1.6.1): one window of the rows the current filter matches,
 * and how many there are in all.
 *
 * A window rather than everything, because the screen fetches as it scrolls —
 * the whole unfiltered set is half a megabyte of JSON to show twenty rows of.
 * Unlike the rule detail endpoint, which hands over all 340 rows of a rule, the
 * row universe is the size of the export and keeps growing.
 *
 * `{ rows, total }` rather than a bare array, unlike `RulesListResponse`:
 * `total` is what the heading says, and what tells the screen whether there is
 * more to fetch.
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

/** The four states a row's `state` filter may name (1.6.1, and B4's `imported`). */
const filterableStates: Record<RowState, true> = {
  imported: true,
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
    throw new BadRequestException(
      'state must be one of "imported", "pending", "clean" or "rejected"',
    );
  }

  return value as RowState;
}

/**
 * Reads `offset` or `limit` out of the query string, or says what is wrong.
 *
 * Absent means the service's own default, so a caller who asks for no window
 * gets the first one. Present and not a whole number is a 400: a mistyped
 * `limit` that silently became a default would hand back a different slice from
 * the one that was asked for, and the caller would never know.
 *
 * `zeroAllowed` is the one difference between the two. An offset of zero is the
 * first row; a limit of zero is a call that asks for nothing, which is a caller
 * bug rather than a request worth serving.
 */
function readCount(value: unknown, name: string, zeroAllowed: boolean): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const pattern = zeroAllowed ? /^\d+$/ : /^[1-9]\d*$/;

  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new BadRequestException(
      `${name} must be a ${zeroAllowed ? 'non-negative' : 'positive'} integer`,
    );
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
 * Everything is read from the query string, not the body: this is a GET.
 * `table` and `state` are the narrowing 1.6.1 describes ("filtered to one
 * state") plus the table filter; `offset` and `limit` are the window the screen
 * asks for as it scrolls. None is required — a caller who names nothing gets an
 * unfiltered first window.
 */
@Controller('rows')
export class RowsListController {
  constructor(private readonly rows: RowListService) {}

  @Get()
  async list(
    @Query('table') table: unknown,
    @Query('state') state: unknown,
    @Query('offset') offset: unknown,
    @Query('limit') limit: unknown,
  ): Promise<RowsListResponse> {
    return await this.rows.list({
      table: readTable(table),
      state: readState(state),
      offset: readCount(offset, 'offset', true),
      limit: readCount(limit, 'limit', false),
    });
  }
}
