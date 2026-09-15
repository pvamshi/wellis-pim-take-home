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
  Patch,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { IntakeStep } from '../patient/validation/intake-validators';
import { IntakeService, type IntakeView } from './intake.service';

/** 422 everywhere is `{ message, errors }` (2.9). One helper so every intake endpoint throws the same shape. */
function unprocessable(errors: unknown): UnprocessableEntityException {
  return new UnprocessableEntityException({ message: 'validation failed', errors });
}

/**
 * Reads `step` off a PATCH body (2.9: `PATCH /intakes/:id` carries no step
 * segment of its own). By hand, like every other request-shape check in this
 * codebase (`approve.controller.ts`'s `readAddress`) — a body that is not an
 * object, or whose `step` is not 1-5, is a 400; which step's fields are
 * actually valid is `validateIntakeStep`'s question, not this one's.
 */
function readStep(body: unknown): IntakeStep {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('a body with a "step" field (1-5) is required');
  }

  const { step } = body as Record<string, unknown>;

  if (step !== 1 && step !== 2 && step !== 3 && step !== 4 && step !== 5) {
    throw new BadRequestException('step must be 1, 2, 3, 4 or 5');
  }

  return step;
}

/**
 * The intake form's four endpoints (2.3, 2.9). It composes and nothing else:
 * `IntakeService` owns every transaction and returns an outcome value, never
 * an HTTP exception (services throw none), so this controller's only job is
 * picking the request apart and picking the status code.
 */
@Controller('intakes')
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  /** Step 1 saved (2.3): creates the draft. 422 on an invalid step 1. */
  @Post()
  async create(@Body() body: unknown): Promise<IntakeView> {
    const outcome = await this.intake.create(body);

    if (outcome.outcome === 'invalid') {
      throw unprocessable(outcome.errors);
    }

    return outcome.view;
  }

  /** One step saved (2.3). 409 if the draft has already been submitted, or names no row at all; 422 on that step's own invalid fields. */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async patch(@Param('id') id: string, @Body() body: unknown): Promise<IntakeView> {
    const step = readStep(body);
    const outcome = await this.intake.patch(id, step, body);

    if (outcome.outcome === 'not-draft') {
      throw new ConflictException(`intake "${id}" is not a draft`);
    }

    if (outcome.outcome === 'invalid') {
      throw unprocessable(outcome.errors);
    }

    return outcome.view;
  }

  /** Validate all, `submitted` → `auto_*` (2.9). 409 not draft · 409 email taken · 422. */
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  async submit(@Param('id') id: string): Promise<IntakeView> {
    const outcome = await this.intake.submit(id);

    if (outcome.outcome === 'not-draft') {
      throw new ConflictException(`intake "${id}" is not a draft`);
    }

    if (outcome.outcome === 'email-taken') {
      throw new ConflictException({ message: 'validation failed', errors: outcome.errors });
    }

    if (outcome.outcome === 'invalid') {
      throw unprocessable(outcome.errors);
    }

    return outcome.view;
  }

  /** The patient's own neutral view (2.9). 404 for an id naming no patient. */
  @Get(':id')
  async get(@Param('id') id: string): Promise<IntakeView> {
    const view = await this.intake.get(id);

    if (view === null) {
      throw new NotFoundException(`there is no intake "${id}"`);
    }

    return view;
  }
}
