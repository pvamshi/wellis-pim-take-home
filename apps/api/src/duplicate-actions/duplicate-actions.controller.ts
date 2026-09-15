import {
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  DuplicateDecisionsService,
  type DuplicateConfirmReport,
  type DuplicateDismissReport,
} from '../rules/duplicate-decisions.service';

/** What confirming a link did (1.7.5). */
export type DuplicateConfirmResponse = DuplicateConfirmReport;

/** What dismissing a link did (1.7.6). */
export type DuplicateDismissResponse = DuplicateDismissReport;

/**
 * Turns a `not-found`/`not-pending` outcome into the exception that names
 * why there is one: 404 for an id no link carries, 409 — naming the link's
 * current status — for one that is no longer pending (1.7.3). Both services
 * report these two failure shapes the same way, so both controller methods
 * check for them the same way before returning whatever report is left.
 */
function checkOutcome(
  id: string,
  outcome: { readonly outcome: string; readonly status?: string },
): void {
  if (outcome.outcome === 'not-found') {
    throw new NotFoundException(`there is no duplicate link "${id}"`);
  }

  if (outcome.outcome === 'not-pending') {
    throw new ConflictException(`duplicate link "${id}" is already ${outcome.status}`);
  }
}

/**
 * Confirm and dismiss (1.7.5, 1.7.6): the two terminal presses on a pending
 * link, sharing one controller because both address a single resource level
 * — one link by id — the same shape `row-actions.controller.ts` already
 * combines reject and unreject into.
 *
 * It composes and nothing else. `DuplicateDecisionsService` reports
 * `not-found`/`not-pending` as values rather than throwing (services throw no
 * HTTP exceptions); `checkOutcome` is where those become the 404 and 409 this
 * endpoint answers with.
 *
 * Both POST, both 200 rather than Nest's default 201: neither creates a
 * resource at a URL, each reports the state the link ended in.
 */
@Controller('duplicates')
export class DuplicateActionsController {
  constructor(private readonly decisions: DuplicateDecisionsService) {}

  /** Confirm (1.7.5): the link is confirmed, and a patient link's X is rejected alongside it. */
  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@Param('id') id: string): Promise<DuplicateConfirmResponse> {
    const result = await this.decisions.confirm(id);
    checkOutcome(id, result);

    return result as DuplicateConfirmReport;
  }

  /** Dismiss (1.7.6): the link is dismissed and never recorded again (1.7.2). Neither row changes. */
  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  async dismiss(@Param('id') id: string): Promise<DuplicateDismissResponse> {
    const result = await this.decisions.dismiss(id);
    checkOutcome(id, result);

    return result as DuplicateDismissReport;
  }
}
