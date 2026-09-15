import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { IntakeStatus, PatientOrigin } from '../patient/intake-status';
import {
  QUEUE_STATUSES,
  ReviewService,
  type DecideRequest,
  type QueueFilter,
  type ReviewDetail,
  type ReviewQueueEntry,
} from './review.service';

/** What `start`/`decide` hand back — just enough for the screen to update in place; the full picture is a fresh `GET /review/intakes/:id`. */
export interface ReviewStatusResponse {
  readonly id: string;
  readonly status: IntakeStatus;
}

const queueStatuses: ReadonlySet<string> = new Set(QUEUE_STATUSES);
const origins: ReadonlySet<string> = new Set<PatientOrigin>(['intake', 'legacy']);

/** Reads the repeatable/comma-separated `status` query parameter, or says what is wrong with it (2.9: 400). Absent is the service's own default. */
function readStatuses(value: unknown): IntakeStatus[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const raw = Array.isArray(value) ? value : String(value).split(',');
  const statuses = raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0);

  for (const status of statuses) {
    if (!queueStatuses.has(status)) {
      throw new BadRequestException(`status must be one of ${[...queueStatuses].join(', ')}`);
    }
  }

  return statuses as IntakeStatus[];
}

function readOrigin(value: unknown): PatientOrigin | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || !origins.has(value)) {
    throw new BadRequestException('origin must be "intake" or "legacy"');
  }

  return value as PatientOrigin;
}

/** Reads `{ actor }` off a start request, or says what is wrong with it. */
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

/**
 * Reads `{ decision, note, actor }` off a decide request. `note` absent is
 * folded into the empty string rather than rejected here — 2.4 makes a blank
 * note a 422 ("required trimmed note"), not a 400, so only a `note` of the
 * wrong *type* is this function's to refuse.
 */
function readDecideRequest(body: unknown): DecideRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('a body of { decision, note, actor } is required');
  }

  const { decision, note, actor } = body as Record<string, unknown>;

  if (decision !== 'approved' && decision !== 'rejected') {
    throw new BadRequestException('decision must be "approved" or "rejected"');
  }

  if (typeof actor !== 'string' || actor.trim().length === 0) {
    throw new BadRequestException('actor must be a non-empty string');
  }

  const noteValue = note === undefined || note === null ? '' : note;

  if (typeof noteValue !== 'string') {
    throw new BadRequestException('note must be a string');
  }

  return { decision, note: noteValue, actor };
}

/**
 * The review screen's API (2.4, 2.9). It composes and nothing else:
 * `ReviewService` owns every read and write and reports an outcome value,
 * never an HTTP exception, so this controller only parses the request and
 * picks the status code.
 */
@Controller('review/intakes')
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  /** The queue (2.4): default filter, or `status`/`origin` narrowed. 400 on an unrecognised value. */
  @Get()
  async queue(
    @Query('status') status: unknown,
    @Query('origin') origin: unknown,
  ): Promise<ReviewQueueEntry[]> {
    const filter: QueueFilter = { statuses: readStatuses(status), origin: readOrigin(origin) };

    return await this.review.queue(filter);
  }

  /** One row expanded (2.4): answers, evaluation, status history. 404 for an id naming no patient. */
  @Get(':id')
  async detail(@Param('id') id: string): Promise<ReviewDetail> {
    const detail = await this.review.detail(id);

    if (detail === null) {
      throw new NotFoundException(`there is no intake "${id}"`);
    }

    return detail;
  }

  /** Start review (2.4): `auto_*` → `in_review`. 409 when the row is not `auto_*`. */
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  async start(@Param('id') id: string, @Body() body: unknown): Promise<ReviewStatusResponse> {
    const actor = readActor(body);
    const outcome = await this.review.start(id, actor);

    if (outcome.outcome === 'conflict') {
      throw new ConflictException(`intake "${id}" is not awaiting review`);
    }

    return { id: outcome.patient.id, status: outcome.patient.intakeStatus };
  }

  /** Approve/reject (2.4): `in_review` → `approved`/`rejected`. 409 not in review · 422 blank note. */
  @Post(':id/decide')
  @HttpCode(HttpStatus.OK)
  async decide(@Param('id') id: string, @Body() body: unknown): Promise<ReviewStatusResponse> {
    const request = readDecideRequest(body);
    const outcome = await this.review.decide(id, request);

    if (outcome.outcome === 'conflict') {
      throw new ConflictException(`intake "${id}" is not in review`);
    }

    if (outcome.outcome === 'invalid') {
      throw new UnprocessableEntityException({
        message: 'validation failed',
        errors: outcome.errors,
      });
    }

    return { id: outcome.patient.id, status: outcome.patient.intakeStatus };
  }
}
