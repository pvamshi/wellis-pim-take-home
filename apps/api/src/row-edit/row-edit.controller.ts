import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type { LegacySourceTable } from '../legacy/legacy-source-table';
import { RowEditService, UnknownColumnError, type RowEditReport } from '../rules/row-edit.service';

/** What one hand edit did (1.6.7). */
export type RowEditResponse = RowEditReport;

/**
 * The three short names the `:table` segment may name (1.1.14).
 *
 * Restated here rather than imported from `row-detail.controller.ts`'s
 * `detailableTables` or `row-actions.controller.ts`'s `rowActionTables` —
 * every route family under `rows` already prefers small per-file restatement
 * of this tiny map over cross-file sharing, and this is the fourth to make the
 * same choice.
 */
const editableTables: Record<LegacySourceTable, true> = {
  patient: true,
  intake: true,
  consent: true,
};

/**
 * Reads the `:table` path segment, or says what is wrong with it.
 *
 * Unlike `rows-list.controller.ts`'s `readTable`, absent is never a value
 * here: a path segment is always present, so any string outside the three
 * legal names is unconditionally a 400 — the same reading every sibling
 * controller under `rows` already gives for the same kind of segment.
 */
function readTable(value: string): LegacySourceTable {
  if (!Object.hasOwn(editableTables, value)) {
    throw new BadRequestException('table must be one of "patient", "intake" or "consent"');
  }

  return value as LegacySourceTable;
}

/** The body of an edit, once it has been checked. */
interface EditBody {
  readonly column: string;
  readonly value: string | null;
}

/**
 * Reads `{ column, value }` out of a request body, or says what is wrong with
 * it.
 *
 * By hand, matching every other body parser in this codebase (see
 * `approve.controller.ts`'s `readAddress`): `tech-stack.md` names no
 * validation library.
 *
 * Both fields are required, unlike `approve.controller.ts`'s `readValue` for
 * an ambiguous finding: that flow has an existing proposal to fall back to
 * when nothing is supplied, and an edit has none — omitting `value` is a 400,
 * not a no-op. `null` is how "clear this field" is said (1.2.13's "a blank box
 * is an answer"), so it is accepted and distinct from omitting the field
 * entirely.
 */
function readEditBody(body: unknown): EditBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('a body of { column, value } is required');
  }

  const { column, value } = body as Record<string, unknown>;

  if (typeof column !== 'string' || column.length === 0) {
    throw new BadRequestException('column must be a non-empty string');
  }

  if (value === undefined) {
    throw new BadRequestException('value is required: a string, or null to clear the column');
  }

  if (value !== null && typeof value !== 'string') {
    throw new BadRequestException('value must be a string, or null to clear the column');
  }

  return { column, value };
}

/**
 * The endpoint behind a hand edit (1.6.7): `POST /rows/:table/:legacyId/edit`.
 *
 * It composes and nothing else. The write is `RowEditService`'s, which lives
 * in the module that owns the legacy and rule tables (1.1.3) and is exported
 * from it for exactly this — the same division every other row endpoint
 * keeps.
 *
 * A sibling of `row-actions/`, not a fifth route on `RowActionsController`:
 * that controller's own docstring commits to "the four row-wide presses" that
 * act on every finding on a row at once, and an edit is a different shape of
 * address entirely — one named column, one supplied value, via the body —
 * plus a different table (a `rule` insert, not a bulk status flip on the rule
 * tables `RowActionsController`'s services already write).
 *
 * `UnknownColumnError` is translated here, not in the service: services do
 * not throw HTTP exceptions in this codebase, controllers do. A null result
 * (no legacy row with this id) becomes the same 404 `RowDetailController`
 * already gives for the identical `(table, legacyId)` address shape.
 *
 * 200, not Nest's default 201: nothing here is a resource created at a URL,
 * it is a report of work done — the same line `RowActionsController`'s own
 * docstring draws for its four routes.
 */
@Controller('rows')
export class RowEditController {
  constructor(private readonly rowEdit: RowEditService) {}

  @Post(':table/:legacyId/edit')
  @HttpCode(HttpStatus.OK)
  async edit(
    @Param('table') table: string,
    @Param('legacyId') legacyId: string,
    @Body() body: unknown,
  ): Promise<RowEditResponse> {
    const validTable = readTable(table);
    const { column, value } = readEditBody(body);

    let report: RowEditReport | null;

    try {
      report = await this.rowEdit.edit(validTable, legacyId, column, value);
    } catch (error) {
      if (error instanceof UnknownColumnError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }

    if (report === null) {
      throw new NotFoundException(`there is no ${table} row "${legacyId}"`);
    }

    return report;
  }
}
