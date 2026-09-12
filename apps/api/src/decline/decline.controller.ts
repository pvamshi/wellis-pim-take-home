import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { RuleVersionsService, type RuleDeclineReport } from '../rules/rule-versions.service';

/**
 * What one press of Decline did (1.2.6).
 *
 * Informational, the way the approve and apply-rules endpoints already report
 * what their press did. The screen refreshes by re-reading the rules list
 * (1.2.1), not from this body — a declined rule leaves that list, because the
 * list is the active versions.
 */
export type DeclineResponse = RuleDeclineReport;

/**
 * The body of a rule-level decline: the reason, if the user gave one.
 *
 * Declared for the reader, not for a validator. Nothing coerces a request into
 * this shape; `readReason` below checks the one field and says so when it is
 * wrong.
 */
export interface DeclineRuleRequest {
  /** Optional (1.2.6). Absent, null and blank all mean no reason recorded. */
  reason?: string | null;
}

/**
 * Reads the reason out of a request body, or says what is wrong with it.
 *
 * By hand, and deliberately: `tech-stack.md` is the source of truth for
 * technology and names no validation library, so class-validator and a global
 * pipe are not introduced for one optional field — `approve.controller.ts` set
 * that precedent for four.
 *
 * No body at all, `{}` and `{ reason: null }` are all the same request: a
 * decline with no reason, which 1.2.6's second scenario asks for. A `reason`
 * that is present and is not a string is the caller's mistake and nothing else
 * — a 400, so a number or an object never reaches the column as a coerced
 * string that later reads like feedback.
 *
 * Trimming and the blank-is-no-reason rule are not here. They are how the
 * reason is *stored*, so they live with the write, in `RuleVersionsService`.
 */
function readReason(body: unknown): string | null {
  if (body === undefined || body === null) {
    return null;
  }

  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('a body of { reason } is required, or no body at all');
  }

  const { reason } = body as Record<string, unknown>;

  if (reason === undefined || reason === null) {
    return null;
  }

  if (typeof reason !== 'string') {
    throw new BadRequestException('reason must be a string');
  }

  return reason;
}

/**
 * The endpoint behind the rule-level cross (1.2.6).
 *
 * It composes and nothing else. Declining writes `rule_version`, and
 * `RuleVersionsService` is declared to be the one write path onto that table —
 * the place the "exactly one version is active" invariant of 1.1.8 is kept — so
 * the press lives there and this controller only resolves the request.
 *
 * Two things worth stating:
 *
 * - **Nothing is deleted and no rule row is decided.** A rule is never deleted
 *   (1.1.8): its active version goes inactive, so the rule leaves the screen
 *   (1.2.1) and its pending findings wait for the revision workflow (1.5.1).
 *   Crossing out a single row is a different press entirely (1.2.7).
 * - **A rule with nothing active is a count, not a fault.** Declining twice, or
 *   naming a rule id nobody has written, answers 200 with `version: null` and
 *   writes nothing — the same line `ApproveController` draws, for an operator
 *   who is one of us (1.2.12).
 *
 * The route sits under `rules` beside `POST /rules/:ruleId/approve` and
 * `POST /rules/apply`, so the rules screen talks to one prefix, and it is POST
 * because it writes.
 */
@Controller('rules')
export class DeclineController {
  constructor(private readonly versions: RuleVersionsService) {}

  /**
   * Declines a rule (1.2.6). 200 rather than Nest's default 201: no resource is
   * created at a URL, the call reports on work it did.
   */
  @Post(':ruleId/decline')
  @HttpCode(HttpStatus.OK)
  async declineRule(
    @Param('ruleId') ruleId: string,
    @Body() body: unknown,
  ): Promise<DeclineResponse> {
    return await this.versions.decline(ruleId, readReason(body));
  }
}
