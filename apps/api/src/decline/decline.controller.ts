import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import type { LegacySourceTable } from '../legacy/legacy-source-table';
import {
  RuleRowDeclinesService,
  type RuleRowDeclineAddress,
  type RuleRowDeclineReport,
} from '../rules/rule-row-declines.service';
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
 * What one press of the row-level cross did (1.2.7).
 *
 * A different shape from `DeclineResponse` above, because the two presses
 * decide different things: the rule-level cross names the version it parked,
 * this one counts the rule row it crossed out. Informational either way — the
 * screen refreshes by re-reading the rule's rows (1.2.2), not from this body.
 */
export type DeclineRowResponse = RuleRowDeclineReport;

/**
 * The body of a row-level decline: the four parts of a rule row's primary key
 * the URL does not already carry, and the reason if the user gave one.
 *
 * Declared for the reader, not for a validator. Nothing coerces a request into
 * this shape; `readRowAddress` below checks each field and says so when one is
 * wrong, and `readReason` checks the reason exactly as it does for the
 * rule-level press.
 */
export interface DeclineRowRequest {
  table: LegacySourceTable;
  legacyId: string;
  /** Integer, matching `rule_version.version`. */
  version: number;
  column: string;
  /** Optional (1.2.7). Absent, null and blank all mean no reason recorded. */
  reason?: string | null;
}

/**
 * The three short names a row address may name (1.1.14).
 *
 * A `Record` keyed on the union rather than an array of strings, so adding a
 * fourth legacy source fails to compile here instead of silently rejecting
 * every address against it.
 */
const declinableTables: Record<LegacySourceTable, true> = {
  patient: true,
  intake: true,
  consent: true,
};

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
 * Reads a row address out of a request body, or says what is wrong with it.
 *
 * By hand, for the reason `readReason` above gives: `tech-stack.md` names no
 * validation library, so class-validator and a global pipe are not introduced
 * for four fields. Everything checked here is the shape of the request — a body
 * that is not an object, a table that is not one of the three, a version that
 * is not a whole number. Whether the address exists, and whether the row it
 * names is still pending, is the service's answer and not this function's.
 *
 * A deliberate copy of `approve.controller.ts`'s `readAddress` rather than a
 * shared parser: the codebase states its preference for a file-local parser or
 * map over premature sharing, extracting one would edit a file another task
 * owns, and the ticked cross (1.2.8) will be the third caller — the point at
 * which lifting it is actually motivated.
 */
function readRowAddress(ruleId: string, body: unknown): RuleRowDeclineAddress {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException(
      'a body of { table, legacyId, version, column, reason? } is required',
    );
  }

  const { table, legacyId, version, column } = body as Record<string, unknown>;

  if (typeof table !== 'string' || !Object.hasOwn(declinableTables, table)) {
    throw new BadRequestException('table must be one of "patient", "intake" or "consent"');
  }

  if (typeof legacyId !== 'string' || legacyId.length === 0) {
    throw new BadRequestException('legacyId must be a non-empty string');
  }

  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new BadRequestException('version must be an integer');
  }

  if (typeof column !== 'string' || column.length === 0) {
    throw new BadRequestException('column must be a non-empty string');
  }

  return { table, legacyId, ruleId, version, column };
}

/**
 * The two endpoints behind the cross: Decline on a whole rule (1.2.6), and the
 * cross on a single row with "modify the rule" unticked (1.2.7).
 *
 * It composes and nothing else. Each press is a service in `RulesModule` —
 * `RuleVersionsService`, the one write path onto `rule_version` and so the
 * place the "exactly one version is active" invariant of 1.1.8 is kept, and
 * `RuleRowDeclinesService`, which writes the per-source rule tables (1.1.3).
 * This controller only resolves the request.
 *
 * The two levels look symmetric and are not, which is the thing to be clear
 * about before wiring a button to either:
 *
 * - **The rule-level press parks the version and decides no row.** A rule is
 *   never deleted (1.1.8): its active version goes inactive with `needsReview`
 *   true, so the rule leaves the screen (1.2.1) and its pending findings wait
 *   for the revision workflow (1.5.1), still pending.
 * - **The row-level press declines one rule row and touches no version.** That
 *   row is settled forever (1.2.7, 1.2.9) and the rule keeps running: its other
 *   rows stay pending and approvable, and its active version is left exactly as
 *   it was.
 *
 * **The ticked checkbox is neither of these.** 1.2.8 — cross out the row *and*
 * tick "modify the rule" — declines no row and parks the version instead, with
 * the reason stored against the version rather than the row. That is a third
 * press, and it is not implemented in this controller: sending a ticked cross
 * to `rows/decline` would decline the row that 1.2.8 says must stay eligible,
 * which is the opposite of what the tick means. It gets a route of its own.
 *
 * **A press with nothing to act on is a count, not a fault.** Declining a rule
 * twice, a rule id nobody has written, an address no rule table holds, a row
 * already approved or already declined — each answers 200 having written
 * nothing and says so in its report. Only a malformed request is a 400. That is
 * the same line `ApproveController` draws, for an operator who is one of us
 * pressing from a screen that may be a moment stale (1.2.12).
 *
 * The routes sit under `rules` beside `POST /rules/:ruleId/approve`,
 * `POST /rules/:ruleId/rows/approve` and `POST /rules/apply`, so the rules
 * screen talks to one prefix, and both are POST because both write.
 */
@Controller('rules')
export class DeclineController {
  constructor(
    private readonly versions: RuleVersionsService,
    private readonly rowDeclines: RuleRowDeclinesService,
  ) {}

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

  /**
   * Declines one rule row (1.2.7). The rule id comes from the URL and the rest
   * of the row's primary key from the body, because that key is the only way to
   * address a finding — rule rows have no surrogate id.
   *
   * The address is read before the reason, so a request that names no row is a
   * 400 about the row rather than about a reason nobody could have stored.
   * Unlike the rule-level press, the body is not optional: there is nothing for
   * this route to act on without one.
   */
  @Post(':ruleId/rows/decline')
  @HttpCode(HttpStatus.OK)
  async declineRow(
    @Param('ruleId') ruleId: string,
    @Body() body: unknown,
  ): Promise<DeclineRowResponse> {
    return await this.rowDeclines.declineRow(readRowAddress(ruleId, body), readReason(body));
  }
}
