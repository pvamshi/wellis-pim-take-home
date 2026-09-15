import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LegacyPatientImportService,
  type BulkImportRowResult,
} from './legacy-patient-import.service';

/** What one individual import did (2.6, 2.9). */
export interface LegacyPatientImportResponse {
  readonly imported: true;
  readonly patientId: string;
  readonly intakeStatus: string;
}

/** Reads `{ actor }` off a request body, or says what is wrong with it — the staff name 2.6's audit events are written under. */
function readActor(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('a body of { actor } is required');
  }

  const { actor } = body as Record<string, unknown>;

  if (typeof actor !== 'string' || actor.trim().length === 0) {
    throw new BadRequestException('actor must be a non-empty string');
  }

  return actor;
}

/** Reads `{ legacyIds, actor }` off a bulk-import request body, or says what is wrong with it. */
function readBulkRequest(body: unknown): { legacyIds: string[]; actor: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('a body of { legacyIds, actor } is required');
  }

  const { legacyIds } = body as Record<string, unknown>;

  if (
    !Array.isArray(legacyIds) ||
    legacyIds.length === 0 ||
    !legacyIds.every((id): id is string => typeof id === 'string' && id.length > 0)
  ) {
    throw new BadRequestException('legacyIds must be a non-empty array of non-empty strings');
  }

  return { legacyIds, actor: readActor(body) };
}

/**
 * Individual and bulk legacy import (2.6, 2.9). It composes and nothing else:
 * `LegacyPatientImportService.importOne` owns the whole per-row flow and
 * reports an outcome value, never an HTTP exception.
 *
 * The individual route turns that outcome into a real status code —
 * `precondition-failed` → 409 with the reason, `invalid` → 422 with every
 * field error. The bulk route never does: 2.6 makes every row's own result
 * part of the 200 body (`imported`/`errors`), so a bad row is reported, not
 * thrown — `readBulkRequest` is the only thing that can 400 this route, for a
 * malformed request shape.
 *
 * Both share the `rows` prefix `rows-list/`, `row-detail/` and
 * `row-actions/` already use: `patient/:legacyId/import` and `import` are
 * both static-final-segment routes those controllers' `:table/:legacyId/...`
 * patterns never match (a literal "approve"/"decline"/"reject"/"unreject"
 * there, never "import"), so nothing here shadows them or is shadowed by
 * them.
 */
@Controller('rows')
export class LegacyPatientImportController {
  constructor(private readonly imports: LegacyPatientImportService) {}

  @Post('patient/:legacyId/import')
  @HttpCode(HttpStatus.OK)
  async importOne(
    @Param('legacyId') legacyId: string,
    @Body() body: unknown,
  ): Promise<LegacyPatientImportResponse> {
    const actor = readActor(body);
    const outcome = await this.imports.importOne(legacyId, actor);

    if (outcome.outcome === 'precondition-failed') {
      throw new ConflictException(outcome.reason);
    }

    if (outcome.outcome === 'invalid') {
      throw new UnprocessableEntityException({
        message: 'validation failed',
        errors: outcome.errors,
      });
    }

    return { imported: true, patientId: outcome.patientId, intakeStatus: outcome.intakeStatus };
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  async importMany(@Body() body: unknown): Promise<BulkImportRowResult[]> {
    const { legacyIds, actor } = readBulkRequest(body);

    return await this.imports.importMany(legacyIds, actor);
  }
}
