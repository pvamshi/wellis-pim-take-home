import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { RuleDetailService, type RuleDetail } from '../rules/rule-detail.service';

/**
 * One expanded rule (1.2.2): what the rule is, and its two sections.
 *
 * The service's shape unchanged, named here so the screen and its tests have
 * one import for it — exactly what `RulesListResponse` already does for the
 * list.
 */
export type RuleDetailResponse = RuleDetail;

/**
 * The endpoint behind expanding a rule (1.2.2, 1.2.3).
 *
 * It delegates and nothing else. The read is `RuleDetailService`'s, which lives
 * in the module that owns the rules tables (1.1.3) and is exported from it for
 * exactly this — the same division `rules-list/`, `approve/`, `decline/` and
 * `apply-rules/` already keep between an endpoint and the layer it reads or
 * presses on.
 *
 * Three things the code does not say on its own:
 *
 * - **The 404 is here, not in the service.** The service answers null for a
 *   rule id nobody has written, and HTTP status is the controller's to choose —
 *   the same line the presses draw by keeping `BadRequestException` out of
 *   `RuleApprovalsService`. A rule that exists but has no active version is not
 *   a 404: it is a rule parked by a decline (1.2.6), and it answers 200 with
 *   two empty sections.
 * - **No `@HttpCode`.** Nest answers a GET with 200 already; the presses
 *   override only because a POST defaults to 201.
 * - **No pagination, no body, no validation pipe.** The rule id is the whole
 *   input, and which rows come back is decided by the active version and their
 *   status (1.2.2), never by the caller. A section's length is its count, and
 *   "Apply rules" re-reads from scratch anyway (1.2.10).
 *
 * It shares the `rules` prefix with the list and the four POSTs, so the rules
 * screen talks to one prefix. `GET /rules/:ruleId` cannot shadow `GET /rules`
 * — the paths differ — and none of the other `:ruleId` routes is a GET.
 */
@Controller('rules')
export class RuleDetailController {
  constructor(private readonly rules: RuleDetailService) {}

  @Get(':ruleId')
  async detail(@Param('ruleId') ruleId: string): Promise<RuleDetailResponse> {
    const detail = await this.rules.detail(ruleId);

    if (detail === null) {
      throw new NotFoundException(`there is no rule "${ruleId}"`);
    }

    return detail;
  }
}
