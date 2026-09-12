/**
 * The backend's /health response.
 *
 * Deliberately permissive: the backend is being built in parallel and has not
 * fixed its response body, so the page renders whatever comes back instead of
 * depending on a field that may not exist.
 */
export type HealthResponse = { status?: string; [key: string]: unknown };

/**
 * One line of the rules screen: a rule whose active version has work waiting
 * (1.2.1).
 *
 * The backend's `RuleListEntry` (`apps/api/src/rules/rule-list.service.ts`) is
 * the source of truth for these four fields; this is a restatement of it, not a
 * second definition. The workspaces are `apps/*` only, so there is no shared
 * package to import the interface from — `HealthResponse` above set that
 * precedent.
 *
 * Unlike `HealthResponse` this one is exact rather than permissive: the
 * endpoint it mirrors is built, and its fields are fixed. If the two ever
 * disagree, the backend is right and this file is the bug.
 */
export interface RuleListEntry {
  readonly ruleId: string;
  readonly ruleName: string;
  /** The active version, and so the version the count belongs to (1.1.8). */
  readonly version: number;
  /** Rows of this rule and version still awaiting a decision. Never zero. */
  readonly pending: number;
}

/**
 * The backend's `GET /rules` response: a bare array, already filtered to active
 * versions with pending rows and already sorted most-pending-first (1.2.1).
 */
export type RulesListResponse = RuleListEntry[];

/** Which legacy source a finding is against (1.1.14). */
export type LegacySourceTable = 'patient' | 'intake' | 'consent';

/**
 * One row of an expanded rule (1.2.2), before and after (1.2.3).
 *
 * A restatement of the backend's `RuleDetailRow`
 * (`apps/api/src/rules/rule-detail.service.ts`), exactly as `RuleListEntry`
 * above restates the list's row: the backend owns the shape, and if the two
 * disagree this file is the bug.
 *
 * `ruleId` and `version` are deliberately not here. They are the same on every
 * row of one detail, so they sit on the detail once — and a row action takes
 * the rule id and the version from there, which is what makes
 * `(table, legacyId, column)` plus the detail a complete row address.
 */
export interface RuleDetailRow {
  readonly table: LegacySourceTable;
  /** Theirs, and not unique (1.0.3) — it names a row, it does not identify one. */
  readonly legacyId: string;
  /** The column the rule tested, and so the column it changes (1.1.5). */
  readonly column: string;
  /** What that column held when the rule ran. Null when it held nothing. */
  readonly previousValue: string | null;
  /**
   * What the rule proposes instead — the key is absent entirely on an ambiguous
   * rule (1.1.12, 1.2.3), whose rows have no proposed value at all.
   *
   * Optional rather than `string | null`, because null is a value a rule may
   * legitimately propose: clearing a column. The screen must be able to tell
   * "there is no fix, read the description" from "the fix is to empty this
   * column", so it reads `ambiguous` on the detail and never infers it here.
   */
  readonly nextValue?: string | null;
}

/**
 * One expanded rule: what it is, and its two sections (1.2.2).
 *
 * `description` and `ambiguous` are what 1.2.3's second sentence needs — an
 * ambiguous rule's rows show the previous value and the rule's description in
 * place of a new value. They are on the detail rather than on each row because
 * ambiguity is a property of the rule, never of the row (1.1.12).
 */
export interface RuleDetailResponse {
  readonly ruleId: string;
  readonly ruleName: string;
  /** For an ambiguous rule, what the human reads instead of a value (1.1.12). */
  readonly description: string;
  /** True when this rule finds problems it cannot fix (1.1.12). */
  readonly ambiguous: boolean;
  /**
   * The active version, and so the version both sections belong to (1.1.8).
   * Null when the rule has no active version — declined and not yet revised
   * (1.2.6), in which case both sections are empty.
   */
  readonly version: number | null;
  /** Rows still awaiting a decision (1.2.2). */
  readonly pending: RuleDetailRow[];
  /** Rows already approved and applied (1.2.2). */
  readonly approved: RuleDetailRow[];
}

/**
 * A rule row's address, minus the rule id the URL carries.
 *
 * Rule rows have no surrogate id: `(legacyId, ruleId, version, column)` is the
 * primary key, so this is the only way a press can name one row (1.2.4, 1.2.7).
 * The version is the detail's active version, which is the version both
 * sections were read from.
 */
export interface RuleRowAddress {
  readonly table: LegacySourceTable;
  readonly legacyId: string;
  /** Integer, matching `rule_version.version`. */
  readonly version: number;
  readonly column: string;
}

/**
 * What one press of Approve did (1.2.4), at either level.
 *
 * Informational. The screen's state always comes from re-reading the detail and
 * the list; this body is what the one-line outcome above the list is built
 * from, which is the only way a rule-level press stays visible after the rule
 * leaves the list (1.2.1).
 */
export interface ApproveReport {
  readonly ruleId: string;
  /** Null only when a rule-level press found no active version to act on. */
  readonly version: number | null;
  /** Rule rows moved from pending to approved. */
  readonly approved: number;
  /**
   * Legacy data rows written. It can exceed `approved`: a finding addresses a
   * legacy id and two data rows may share one (1.0.3).
   */
  readonly updated: number;
}

/** What one press of Decline on a rule did (1.2.6). Informational. */
export interface RuleDeclineReport {
  readonly ruleId: string;
  /** The version that went inactive. Null when there was no active version. */
  readonly version: number | null;
  /** The reason stored on that version, or null when none was given (1.2.6). */
  readonly reason: string | null;
}

/** What one press of the cross on a single row did (1.2.7). Informational. */
export interface RowDeclineReport {
  readonly ruleId: string;
  /** Never null: a row-level press names the version in its address. */
  readonly version: number;
  /** Rule rows moved to declined: one, or none when the row was already settled. */
  readonly declined: number;
  /** The reason stored on that row, or null when none was given (1.2.7). */
  readonly reason: string | null;
}

/**
 * What one press of the cross with "modify the rule" ticked did (1.2.8).
 * Informational.
 *
 * A restatement of the backend's `ReviseFromRowResponse`
 * (`apps/api/src/decline/decline.controller.ts`), exactly as the reports above
 * restate theirs: the backend owns the shape, and if the two disagree this file
 * is the bug.
 *
 * Written out flat rather than as `extends RuleDeclineReport`, although the
 * backend declares it that way. The two are the same three fields plus `row`,
 * and the contract spec that holds this copy to the endpoint reads these
 * declarations as text — an inherited field would not be in the text it reads,
 * so a field that moved would stop being checked.
 *
 * This press decides no row at all, which is the whole of 1.2.8: `row` is the
 * address that was sent, echoed back so the caller can see the press it made is
 * the press that landed. The row it names is still pending.
 */
export interface ReviseFromRowReport {
  readonly ruleId: string;
  /**
   * The version that was parked — the rule's active version, made inactive with
   * `needsReview` true. Null when there was no active version to park.
   */
  readonly version: number | null;
  /** The reason stored on that version, or null when none was given (1.2.8). */
  readonly reason: string | null;
  /** The address the press named, echoed back. Nothing was written from it. */
  readonly row: RuleRowAddress;
}
