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
  RuleApprovalsService,
  type RuleApprovalReport,
  type RuleRowAddress,
} from '../rules/rule-approvals.service';

/**
 * What one press of Approve did (1.2.4), at either level.
 *
 * `approved` counts rule rows moved to approved and `updated` counts legacy
 * data rows written; the second can exceed the first, because two legacy rows
 * may share one legacy id (1.0.3). The screen refreshes by re-reading the rule
 * rows rather than from this body — it is how the press is checkable by
 * comparing counts, which is the precedent the importer and the apply-rules
 * endpoint both set.
 */
export type ApproveResponse = RuleApprovalReport;

/**
 * The body of a row-level approve: the four parts of a rule row's primary key
 * that the URL does not already carry.
 *
 * Declared for the reader, not for a validator. Nothing coerces a request into
 * this shape; `readAddress` below checks each field and says so when one is
 * wrong.
 */
export interface ApproveRowRequest {
  table: LegacySourceTable;
  legacyId: string;
  /** Integer, matching `rule_version.version`. */
  version: number;
  column: string;
}

/**
 * The three short names a row address may name (1.1.14).
 *
 * A `Record` keyed on the union rather than an array of strings, so adding a
 * fourth legacy source fails to compile here instead of silently rejecting
 * every address against it.
 */
const approvableTables: Record<LegacySourceTable, true> = {
  patient: true,
  intake: true,
  consent: true,
};

/**
 * Reads a row address out of a request body, or says what is wrong with it.
 *
 * By hand, and deliberately: `tech-stack.md` is the source of truth for
 * technology and names no validation library, so class-validator and a global
 * pipe are not introduced for four fields. Everything checked here is the shape
 * of the request — a body that is not an object, a table that is not one of the
 * three, a version that is not a whole number. Whether the address exists is
 * the service's answer, not this function's.
 */
function readAddress(ruleId: string, body: unknown): RuleRowAddress {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('a body of { table, legacyId, version, column } is required');
  }

  const { table, legacyId, version, column } = body as Record<string, unknown>;

  if (typeof table !== 'string' || !Object.hasOwn(approvableTables, table)) {
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
 * Reads the value the human typed for an ambiguous finding, or undefined when
 * they typed none.
 *
 * Absent and null are the same request — the ordinary approve, applying what
 * the rule proposed. A blank string is not: clearing a column is a legitimate
 * answer to "what should this be", and refusing it here would mean the one
 * answer the screen cannot give is the empty one. Only the wrong *type* is a
 * bad request.
 */
function readValue(body: unknown): string | undefined {
  const { value } = body as Record<string, unknown>;

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException('value must be a string when it is given');
  }

  return value;
}

/**
 * The two endpoints behind the tick (1.2.4): Approve on a whole rule, and
 * Approve on a single row.
 *
 * It composes and nothing else. Both presses are `RuleApprovalsService`, which
 * lives beside the findings writer because 1.1.3 puts persistence and the apply
 * transaction in one layer; this controller resolves the address out of the
 * request and returns what the press did.
 *
 * Three things worth stating:
 *
 * - **The run/apply split of transactions is not repeated here.** The
 *   apply-rules endpoint deliberately runs rules outside a transaction, because
 *   rules read the modified data and must not be handed a write path. An
 *   approve runs no rule: it is one transaction end to end, which is what 1.2.5
 *   asks for — the rule row's status and the data row's column land or fail
 *   together.
 * - **Nothing is caught.** A press that names nothing it can act on is not an
 *   error; it reports zero rows approved. What is left is a finding that cannot
 *   be applied — no value, an unknown column, a missing legacy row — which is a
 *   rule-authoring fault and nobody's request was wrong, so it surfaces as a
 *   500 with the transaction rolled back and nothing written. That is the same
 *   line `ApplyRulesController` draws.
 * - **Nothing guards against two presses at once.** The end user is one of us
 *   (1.2.12), and a press only ever moves rows that are still pending, so the
 *   second of two simultaneous presses finds nothing left to do.
 *
 * The routes sit under `rules` beside `POST /rules/apply`, so the rules screen
 * talks to one prefix, and both are POST because both write.
 */
@Controller('rules')
export class ApproveController {
  constructor(private readonly approvals: RuleApprovalsService) {}

  /**
   * Approves every pending row of the rule's active version (1.2.4, first
   * scenario). 200 rather than Nest's default 201: no resource is created at a
   * URL, the call reports on work it did.
   *
   * No body at all. Which rows move is decided by what is pending on the active
   * version, never by the caller — which is what makes the rule-level press the
   * one that clears exactly what the screen is showing (1.2.1).
   */
  @Post(':ruleId/approve')
  @HttpCode(HttpStatus.OK)
  async approveRule(@Param('ruleId') ruleId: string): Promise<ApproveResponse> {
    return await this.approvals.approveRule(ruleId);
  }

  /**
   * Approves one rule row (1.2.4, second scenario). The rule id comes from the
   * URL and the rest of the row's primary key from the body, because that key
   * is the only way to address a finding — rule rows have no surrogate id.
   *
   * An optional `value` settles a row an ambiguous rule could not (1.1.12): the
   * human supplies what the rule would not guess, and it is applied down the
   * same path as a proposal of the rule's own. The service refuses it for a row
   * that already proposes a value.
   */
  @Post(':ruleId/rows/approve')
  @HttpCode(HttpStatus.OK)
  async approveRow(
    @Param('ruleId') ruleId: string,
    @Body() body: unknown,
  ): Promise<ApproveResponse> {
    return await this.approvals.approveRow(readAddress(ruleId, body), readValue(body));
  }
}
