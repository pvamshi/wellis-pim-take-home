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
