import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { DuplicateSourceTable, DuplicateStatus } from '../duplicates/duplicate.entity';
import {
  DuplicateListService,
  type DuplicateListEntry,
} from '../rules/duplicate-list.service';

/** The duplicates screen (1.7.4): one window of the links the current filter matches. */
export interface DuplicatesListResponse {
  readonly links: DuplicateListEntry[];
  readonly total: number;
}

/**
 * The three short names a link's `table` filter may name (1.1.14) — the same
 * `Record` shape `rows-list.controller.ts`'s `filterableTables` already uses.
 */
const filterableTables: Record<DuplicateSourceTable, true> = {
  patient: true,
  intake: true,
  consent: true,
};

/** The three states a link's `status` filter may name (1.7.3). */
const filterableStatuses: Record<DuplicateStatus, true> = {
  pending: true,
  confirmed: true,
  dismissed: true,
};

/** Reads the `table` query parameter, or says what is wrong with it. Absent is a real answer. */
function readTable(value: unknown): DuplicateSourceTable | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || !Object.hasOwn(filterableTables, value)) {
    throw new BadRequestException('table must be one of "patient", "intake" or "consent"');
  }

  return value as DuplicateSourceTable;
}

/** Reads the `status` query parameter, or says what is wrong with it. Absent is a real answer. */
function readStatus(value: unknown): DuplicateStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || !Object.hasOwn(filterableStatuses, value)) {
    throw new BadRequestException('status must be one of "pending", "confirmed" or "dismissed"');
  }

  return value as DuplicateStatus;
}

/** Reads `offset` or `limit` out of the query string. Same shape as `rows-list.controller.ts`'s `readCount`. */
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
 * The endpoint the duplicates screen loads (1.7.4).
 *
 * It delegates and nothing else. The join is `DuplicateListService`'s, which
 * lives in the module that owns `duplicate` and `rule` (1.1.3) and is
 * exported from it for exactly this — the same division `rows-list/` keeps
 * from `RowListService`.
 *
 * `table` and `status` narrow the list; `offset` and `limit` are the window.
 * None is required — absent names no filter, matching every other filter
 * endpoint in this codebase. "Pending by default" (1.7.4) is the screen's own
 * initial choice, not this endpoint's: an unfiltered call answers every link.
 */
@Controller('duplicates')
export class DuplicatesListController {
  constructor(private readonly duplicates: DuplicateListService) {}

  @Get()
  async list(
    @Query('table') table: unknown,
    @Query('status') status: unknown,
    @Query('offset') offset: unknown,
    @Query('limit') limit: unknown,
  ): Promise<DuplicatesListResponse> {
    return await this.duplicates.list({
      table: readTable(table),
      status: readStatus(status),
      offset: readCount(offset, 'offset', true),
      limit: readCount(limit, 'limit', false),
    });
  }
}
