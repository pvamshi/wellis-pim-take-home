import type {
  ApplyRulesReport,
  ApproveReport,
  BulkImportRowResult,
  DuplicateConfirmReport,
  DuplicateDetail,
  DuplicateDismissReport,
  DuplicateStatus,
  DuplicatesListResponse,
  FieldError,
  HealthResponse,
  IntakeStatus,
  IntakeStep,
  IntakeView,
  LegacyPatientImportResponse,
  LegacySourceTable,
  PatientOrigin,
  ReviewDetail,
  ReviewQueueEntry,
  ReviewStatusResponse,
  ReviseFromRowReport,
  RowApproveAllReport,
  RowDeclineAllReport,
  RowDeclineReport,
  RowDetailResponse,
  RowRejectionReport,
  RowEditReport,
  RowState,
  RowsListResponse,
  RuleDeclineReport,
  RuleDetailResponse,
  RuleRowAddress,
  RulesListResponse,
} from './types';

/**
 * The backend base URL. `VITE_API_BASE_URL` is the only variable that names it
 * and `http://localhost:3000` is its documented default (tech-stack §4.6.1);
 * this is the only place either is read. Any trailing slash is stripped so
 * joining a path onto it is safe.
 */
export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);

/** The full health-check URL. This module is the only one that builds one. */
export const healthUrl = `${apiBaseUrl}/health`;

/** The rules-list URL (1.2.1). Built here for the same reason as `healthUrl`. */
export const rulesUrl = `${apiBaseUrl}/rules`;

/**
 * The URL "Apply rules" posts to (1.2.10). A fixed address with nothing in it
 * that varies, so it is built here beside the others rather than by a function.
 */
export const applyRulesUrl = `${rulesUrl}/apply`;

/**
 * The URL of one expanded rule and of the presses against it (1.2.2, 1.2.4,
 * 1.2.7). A rule id is data — it comes from the list, not from a literal — so
 * it is encoded rather than concatenated raw.
 */
export function ruleUrl(ruleId: string, path = ''): string {
  return `${rulesUrl}/${encodeURIComponent(ruleId)}${path}`;
}

/**
 * A backend call that did not produce a usable response. `status` is the HTTP
 * status when there was one, and `null` when the request never got that far.
 */
export class ApiError extends Error {
  readonly status: number | null;
  readonly url: string;

  constructor(message: string, status: number | null, url: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
  }
}

/**
 * An abort raised by a caller cancelling its own request. It is not a failure,
 * so it is re-thrown untouched rather than wrapped in an `ApiError`, and the
 * caller drops it.
 */
function isAbortError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    (value as { name?: unknown }).name === 'AbortError'
  );
}

function describe(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** How one call differs from another: everything else about it is identical. */
interface RequestOptions {
  /** GET by default. `PATCH` is B5's per-step save (2.3) — the one write in this file that is not POST. */
  readonly method?: 'GET' | 'POST' | 'PATCH';
  /**
   * The JSON body, when there is one. Omitted entirely for a press that sends
   * none — a rule-level approve takes no body at all, and a rule-level decline
   * with no reason is exactly an absent body to the backend.
   */
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/**
 * One call that answers with JSON, or an `ApiError` saying why it did not.
 *
 * Every endpoint this app talks to fails in the same three ways — unreachable,
 * a non-2xx answer, a body that is not JSON — so the classification lives once
 * here rather than being copied per call. The caller supplies the URL, which is
 * both what is fetched and what the error carries, so an `ApiError` always
 * names the address that produced it.
 *
 * The presses share it with the reads because they fail identically and answer
 * 200 with a report body; the only difference is the method and the body, so
 * that is the only thing `RequestOptions` carries.
 *
 * The body is asserted, not validated: the backend owns the shape and the
 * types in `./types.ts` restate it. A response that disagrees is a backend bug,
 * not a case this layer can usefully recover from.
 */
async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;
  let response: Response;

  try {
    response = await fetch(url, {
      method,
      // Content-Type only when something is being sent: a POST with no body
      // that announces a JSON body it does not have is a lie about the request.
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    // The request never reached a response: the backend is not running, the
    // host does not resolve, or the browser blocked it. There is no status.
    if (isAbortError(cause)) throw cause;
    throw new ApiError(`Could not reach ${url}: ${describe(cause)}`, null, url);
  }

  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : '';
    throw new ApiError(
      `The backend answered ${response.status}${statusText}.`,
      response.status,
      url,
    );
  }

  try {
    return (await response.json()) as T;
  } catch (cause) {
    if (isAbortError(cause)) throw cause;
    throw new ApiError(
      `The backend answered ${response.status} but the body is not JSON: ${describe(cause)}`,
      response.status,
      url,
    );
  }
}

/** A parsed JSON body, plus the status it came back with. */
interface OutcomeResponse<T> {
  readonly status: number;
  readonly body: T;
}

/**
 * Like `requestJson`, except the statuses in `allow` are not failures.
 *
 * B5's intake and B6's review endpoints answer a 409 or a 422 with a body the
 * caller is meant to read — "not a draft", "email already in use", "that
 * step's fields are invalid" — the same "services throw no HTTP exceptions,
 * every outcome is a value" convention the backend itself follows (2.0),
 * carried onto this side of the wire so a page never has to unwrap an
 * `ApiError` to read a field error out of its message. Every status outside
 * `allow` is still thrown as an `ApiError`, unchanged from `requestJson`:
 * those remain failures with nothing structured on them to read.
 */
async function requestOutcome<T>(
  url: string,
  options: RequestOptions & { readonly allow?: readonly number[] } = {},
): Promise<OutcomeResponse<T>> {
  const { method = 'GET', body, signal, allow = [] } = options;
  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (isAbortError(cause)) throw cause;
    throw new ApiError(`Could not reach ${url}: ${describe(cause)}`, null, url);
  }

  if (!response.ok && !allow.includes(response.status)) {
    const statusText = response.statusText ? ` ${response.statusText}` : '';
    throw new ApiError(
      `The backend answered ${response.status}${statusText}.`,
      response.status,
      url,
    );
  }

  try {
    return { status: response.status, body: (await response.json()) as T };
  } catch (cause) {
    if (isAbortError(cause)) throw cause;
    throw new ApiError(
      `The backend answered ${response.status} but the body is not JSON: ${describe(cause)}`,
      response.status,
      url,
    );
  }
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return await requestJson<HealthResponse>(healthUrl, { signal });
}

/**
 * The rules screen's list (1.2.1).
 *
 * The array comes back already filtered to active versions with pending rows
 * and already sorted most-pending-first. Nothing here re-sorts or re-filters
 * it: that behaviour belongs to the endpoint, and a second copy of it on this
 * side could only ever drift from the first.
 */
export async function getRules(signal?: AbortSignal): Promise<RulesListResponse> {
  return await requestJson<RulesListResponse>(rulesUrl, { signal });
}

/**
 * One expanded rule: its two sections, before and after per row (1.2.2, 1.2.3).
 *
 * Read once per expand and re-read after every press, because the screen's
 * truth is what the backend says it is — never what a press's report body
 * implied.
 */
export async function getRuleDetail(
  ruleId: string,
  signal?: AbortSignal,
): Promise<RuleDetailResponse> {
  return await requestJson<RuleDetailResponse>(ruleUrl(ruleId), { signal });
}

/**
 * The "Apply rules" press (1.2.10): every active rule version runs against the
 * entire dataset and what it finds is written as pending rows.
 *
 * No arguments and no body at all, matching the endpoint. Which rules run is
 * decided by `rule_version` rows, never by the caller, so there is nothing on
 * the screen that could narrow a run even by accident.
 *
 * The report is informational. The screen refreshes by re-reading the list and
 * the expanded rule, because its truth is what the backend says it is — the
 * same rule every press in this file already follows.
 */
export async function applyRules(): Promise<ApplyRulesReport> {
  return await requestJson<ApplyRulesReport>(applyRulesUrl, { method: 'POST' });
}

/**
 * Approve on a whole rule (1.2.4, first scenario).
 *
 * No body at all: which rows move is decided by what is pending on the active
 * version, never by this caller.
 */
export async function approveRule(ruleId: string): Promise<ApproveReport> {
  return await requestJson<ApproveReport>(ruleUrl(ruleId, '/approve'), { method: 'POST' });
}

/**
 * The tick on one row (1.2.4, second scenario). A row approve carries no reason.
 *
 * `value` is what the user typed for a finding an ambiguous rule could not
 * answer (1.1.12): it becomes that row's proposal and is applied down the same
 * path as one of the rule's own. Sent whenever it is given, blank included — an
 * empty box is an answer ("this column should hold nothing"), which is why this
 * is not `reasonField`'s blank-means-absent rule. The backend refuses it for a
 * row that already proposes a value.
 *
 * `note` says why it is that value. It is optional: the rule's description
 * already says what is wrong with the row, so the value is the answer.
 */
export async function approveRow(
  ruleId: string,
  row: RuleRowAddress,
  supplied?: { readonly value: string; readonly note?: string },
): Promise<ApproveReport> {
  return await requestJson<ApproveReport>(ruleUrl(ruleId, '/rows/approve'), {
    method: 'POST',
    body:
      supplied === undefined
        ? row
        : {
            ...row,
            value: supplied.value,
            ...(supplied.note === undefined ? {} : { note: supplied.note }),
          },
  });
}

/**
 * The reason, as a body field, or nothing at all when the user typed none.
 *
 * The two presses that park a version take an optional reason (1.2.6, 1.2.8)
 * and an empty dialog is the same press as a dialog nobody typed into, so a
 * blank or whitespace-only box is omitted from the request entirely rather than
 * sent as `""`. "No reason" is then one state on the wire.
 *
 * It does not trim what it does send. Trimming is how a reason is *stored* and
 * the backend's `storedReason` is the one place that decides it; trimming here
 * as well would make this file a second definition of the same rule, free to
 * drift. All this decides is whether `reason` appears at all.
 */
function reasonField(reason?: string): { reason: string } | undefined {
  return reason !== undefined && reason.trim() !== '' ? { reason } : undefined;
}

/**
 * Decline on a whole rule (1.2.6): its active version goes inactive with
 * `needsReview` true and the reason, if the dialog collected one, is stored on
 * that version, so the rule leaves the list (1.2.1).
 *
 * With no reason there is no body at all, which the backend reads as 1.2.6's
 * second scenario — declined, with nothing recorded in place of a reason.
 */
export async function declineRule(ruleId: string, reason?: string): Promise<RuleDeclineReport> {
  return await requestJson<RuleDeclineReport>(ruleUrl(ruleId, '/decline'), {
    method: 'POST',
    body: reasonField(reason),
  });
}

/**
 * The cross on one row with "modify the rule" unticked (1.2.7): that row is
 * declined forever and the rule is untouched.
 *
 * The tick is not a field of this body. It chooses between this call and
 * `reviseFromRow` below, because the two presses write different tables and the
 * backend deliberately serves them as two routes so that no boolean from a
 * screen can decide which one is written.
 *
 * The reason is optional (1.2.7) and the decline dialog never collects one for
 * this press — the box it shows is the one stored against a version (1.2.6,
 * 1.2.8). An ambiguous rule's rows are the exception: their cross is a box and
 * a button on the row itself, because a row nobody can propose a value for is
 * one where why it was waved through is the only thing left to record.
 */
export async function declineRow(
  ruleId: string,
  row: RuleRowAddress,
  reason?: string,
): Promise<RowDeclineReport> {
  return await requestJson<RowDeclineReport>(ruleUrl(ruleId, '/rows/decline'), {
    method: 'POST',
    body: { ...row, ...reasonField(reason) },
  });
}

/**
 * The same cross with "modify the rule" ticked (1.2.8): the rule's active
 * version is parked for revision with the reason stored against it, and the row
 * that exposed the bug is deliberately left pending so the version that
 * replaces it proposes on that very row.
 *
 * The body is `declineRow`'s address — it is the same button on the same row —
 * plus the reason the dialog collected, which this press stores on the version
 * it parks. Only the route differs between the two, and the route is the whole
 * difference.
 */
export async function reviseFromRow(
  ruleId: string,
  row: RuleRowAddress,
  reason?: string,
): Promise<ReviseFromRowReport> {
  return await requestJson<ReviseFromRowReport>(ruleUrl(ruleId, '/rows/revise'), {
    method: 'POST',
    body: { ...row, ...reasonField(reason) },
  });
}

/** The rows-list URL (1.6.1). Built here for the same reason as `rulesUrl`. */
export const rowsUrl = `${apiBaseUrl}/rows`;

/**
 * The URL of one row and of the presses against it (1.6.3-1.6.7). Table and
 * legacy id are data — they come from the list, not from a literal — so both
 * are encoded rather than concatenated raw, the same reason `ruleUrl` encodes
 * a rule id.
 */
export function rowUrl(table: LegacySourceTable, legacyId: string, path = ''): string {
  return `${rowsUrl}/${encodeURIComponent(table)}/${encodeURIComponent(legacyId)}${path}`;
}

/**
 * What the rows screen's list may be narrowed to (1.6.1), and which window of
 * it is wanted. All four are optional.
 */
export interface RowsListFilter {
  readonly table?: LegacySourceTable;
  readonly state?: RowState;
  /** How many rows to skip — where the next fetch of a scrolling list starts. */
  readonly offset?: number;
  /** How many to ask for. The backend has its own default and its own cap. */
  readonly limit?: number;
}

/**
 * The rows screen's list (1.6.1), narrowed by whatever filter is given.
 *
 * `table` and `state` are left out of the query string entirely when unset,
 * matching the backend's own "absent means no narrowing" reading
 * (`rows-list.controller.ts`'s `readTable`/`readState`) — an "All" filter is
 * silence, not the literal string `"all"`, which the backend would reject.
 */
export async function getRows(
  filter: RowsListFilter = {},
  signal?: AbortSignal,
): Promise<RowsListResponse> {
  const params = new URLSearchParams();
  if (filter.table !== undefined) params.set('table', filter.table);
  if (filter.state !== undefined) params.set('state', filter.state);
  if (filter.offset !== undefined) params.set('offset', String(filter.offset));
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));

  const query = params.toString();
  return await requestJson<RowsListResponse>(query === '' ? rowsUrl : `${rowsUrl}?${query}`, {
    signal,
  });
}

/**
 * One expanded row: its own values, and its findings grouped by rule (1.6.3).
 *
 * Read once per expand and re-read after every press, the same rule
 * `getRuleDetail` follows: the screen's truth is what the backend says it is.
 */
export async function getRowDetail(
  table: LegacySourceTable,
  legacyId: string,
  signal?: AbortSignal,
): Promise<RowDetailResponse> {
  return await requestJson<RowDetailResponse>(rowUrl(table, legacyId), { signal });
}

/**
 * Approve all on a row (1.6.4): every pending finding that proposes a value is
 * approved and written; ambiguous ones are left pending and counted into the
 * report's `skipped`.
 *
 * No body: which findings move is decided by what is pending on the row,
 * never by this caller.
 */
export async function approveAllOnRow(
  table: LegacySourceTable,
  legacyId: string,
): Promise<RowApproveAllReport> {
  return await requestJson<RowApproveAllReport>(rowUrl(table, legacyId, '/approve'), {
    method: 'POST',
  });
}

/**
 * Decline all on a row (1.6.5): every pending finding, ambiguous ones
 * included, declined forever (1.2.9) with the reason given, if any.
 */
export async function declineAllOnRow(
  table: LegacySourceTable,
  legacyId: string,
  reason?: string,
): Promise<RowDeclineAllReport> {
  return await requestJson<RowDeclineAllReport>(rowUrl(table, legacyId, '/decline'), {
    method: 'POST',
    body: reasonField(reason),
  });
}

/**
 * Reject a row (1.6.6): not offered for promotion, with the reason given, if
 * any. Reversible — it writes nothing to the legacy data.
 */
export async function rejectRow(
  table: LegacySourceTable,
  legacyId: string,
  reason?: string,
): Promise<RowRejectionReport> {
  return await requestJson<RowRejectionReport>(rowUrl(table, legacyId, '/reject'), {
    method: 'POST',
    body: reasonField(reason),
  });
}

/**
 * Un-reject a row (1.6.6). No body: there is nowhere on `row_rejection` for an
 * "unreject reason" to be kept once the row is deleted.
 */
export async function unrejectRow(
  table: LegacySourceTable,
  legacyId: string,
): Promise<RowRejectionReport> {
  return await requestJson<RowRejectionReport>(rowUrl(table, legacyId, '/unreject'), {
    method: 'POST',
  });
}

/**
 * A hand edit (1.6.7): one column of one legacy row, written and recorded as
 * an approved finding under the reserved hand-edit rule id.
 *
 * `value` is `null` to clear the column (1.2.13's "a blank box is an
 * answer") — distinct from an empty string, which the backend treats as a
 * deliberate "set it to empty" rather than "clear it".
 *
 * `note` says why, and is required: the backend answers 400 without it.
 */
export async function editRow(
  table: LegacySourceTable,
  legacyId: string,
  column: string,
  value: string | null,
  note: string,
): Promise<RowEditReport> {
  return await requestJson<RowEditReport>(rowUrl(table, legacyId, '/edit'), {
    method: 'POST',
    body: { column, value, note },
  });
}

/** The duplicates-list URL (1.7.4). Built here for the same reason as `rowsUrl`. */
export const duplicatesUrl = `${apiBaseUrl}/duplicates`;

/**
 * The URL of one link and of the presses against it (1.7.4-1.7.6). A link id
 * is data — it comes from the list, not from a literal — so it is encoded
 * rather than concatenated raw, the same reason `ruleUrl` encodes a rule id.
 */
export function duplicateUrl(id: string, path = ''): string {
  return `${duplicatesUrl}/${encodeURIComponent(id)}${path}`;
}

/**
 * What the duplicates screen's list may be narrowed to (1.7.4), and which
 * window of it is wanted. Declared locally rather than in `types.ts`, the
 * same choice `RowsListFilter` makes: this shape is the client's own request,
 * not a restatement of a backend response.
 */
export interface DuplicatesListFilter {
  readonly table?: LegacySourceTable;
  readonly status?: DuplicateStatus;
  /** How many links to skip — where the next fetch of a scrolling list starts. */
  readonly offset?: number;
  /** How many to ask for. The backend has its own default and its own cap. */
  readonly limit?: number;
}

/**
 * The duplicates screen's list (1.7.4), narrowed by whatever filter is given.
 *
 * `table` and `status` are left out of the query string entirely when unset,
 * matching the backend's own "absent means no narrowing" reading
 * (`duplicates-list.controller.ts`'s `readTable`/`readStatus`) — the same
 * convention `getRows` already follows for its own filter.
 */
export async function getDuplicates(
  filter: DuplicatesListFilter = {},
  signal?: AbortSignal,
): Promise<DuplicatesListResponse> {
  const params = new URLSearchParams();
  if (filter.table !== undefined) params.set('table', filter.table);
  if (filter.status !== undefined) params.set('status', filter.status);
  if (filter.offset !== undefined) params.set('offset', String(filter.offset));
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));

  const query = params.toString();
  return await requestJson<DuplicatesListResponse>(
    query === '' ? duplicatesUrl : `${duplicatesUrl}?${query}`,
    { signal },
  );
}

/**
 * One link expanded: both physical rows, side by side, every column (1.7.4).
 *
 * Read once per expand and re-read after every press, the same rule
 * `getRuleDetail` and `getRowDetail` follow: the screen's truth is what the
 * backend says it is.
 */
export async function getDuplicateDetail(
  id: string,
  signal?: AbortSignal,
): Promise<DuplicateDetail> {
  return await requestJson<DuplicateDetail>(duplicateUrl(id), { signal });
}

/**
 * Confirm a pending link (1.7.5): the link is confirmed, and a patient
 * link's X is rejected alongside it — the report's own `rejected` field says
 * which happened. No body: which link to confirm is entirely in the URL.
 */
export async function confirmDuplicate(id: string): Promise<DuplicateConfirmReport> {
  return await requestJson<DuplicateConfirmReport>(duplicateUrl(id, '/confirm'), {
    method: 'POST',
  });
}

/**
 * Dismiss a pending link (1.7.6): the link is dismissed and never recorded
 * again. Neither row changes.
 */
export async function dismissDuplicate(id: string): Promise<DuplicateDismissReport> {
  return await requestJson<DuplicateDismissReport>(duplicateUrl(id, '/dismiss'), {
    method: 'POST',
  });
}

// === B5: the intake form (2.3, 2.9) =========================================

/** The intakes URL (2.3.1). Built here for the same reason as `rulesUrl`. */
export const intakesUrl = `${apiBaseUrl}/intakes`;

/** The URL of one draft and of the two presses against it (2.3, 2.9). */
export function intakeUrl(id: string, path = ''): string {
  return `${intakesUrl}/${encodeURIComponent(id)}${path}`;
}

/** The 422 body's own shape (2.9): `{ message, errors }`. */
interface ValidationErrorBody {
  readonly message: string;
  readonly errors: FieldError[];
}

export type IntakeCreateOutcome =
  | { readonly outcome: 'created'; readonly view: IntakeView }
  | { readonly outcome: 'invalid'; readonly errors: FieldError[] };

/** Step 1 saved (2.3): creates the draft. `fields` are exactly step 1's own three questions. */
export async function createIntake(fields: Record<string, unknown>): Promise<IntakeCreateOutcome> {
  const { status, body } = await requestOutcome<IntakeView | ValidationErrorBody>(intakesUrl, {
    method: 'POST',
    body: fields,
    allow: [422],
  });

  return status === 422
    ? { outcome: 'invalid', errors: (body as ValidationErrorBody).errors }
    : { outcome: 'created', view: body as IntakeView };
}

export type IntakePatchOutcome =
  | { readonly outcome: 'saved'; readonly view: IntakeView }
  | { readonly outcome: 'invalid'; readonly errors: FieldError[] }
  /** No draft at this id — nonexistent or already past `draft` (2.9). */
  | { readonly outcome: 'not-draft' };

/** One step saved (2.3): `fields` are that step's own questions; `step` travels in the body, not the URL (2.9). */
export async function patchIntakeStep(
  id: string,
  step: IntakeStep,
  fields: Record<string, unknown>,
): Promise<IntakePatchOutcome> {
  const { status, body } = await requestOutcome<IntakeView | ValidationErrorBody>(intakeUrl(id), {
    method: 'PATCH',
    body: { step, ...fields },
    allow: [409, 422],
  });

  if (status === 409) return { outcome: 'not-draft' };
  if (status === 422) return { outcome: 'invalid', errors: (body as ValidationErrorBody).errors };
  return { outcome: 'saved', view: body as IntakeView };
}

export type IntakeSubmitOutcome =
  | { readonly outcome: 'submitted'; readonly view: IntakeView }
  | { readonly outcome: 'invalid'; readonly errors: FieldError[] }
  | { readonly outcome: 'not-draft' }
  | { readonly outcome: 'email-taken'; readonly errors: FieldError[] };

/**
 * Validate all, `submitted` → `auto_*` (2.3, 2.9). The 409 branch covers two
 * different backend outcomes sharing one status — "not a draft" (plain
 * message, no `errors`) and "email already in use" (`{ message, errors }`,
 * same shape a 422 carries) — so the two are told apart by whether the body
 * actually has field errors on it, not by status alone.
 */
export async function submitIntake(id: string): Promise<IntakeSubmitOutcome> {
  const { status, body } = await requestOutcome<IntakeView | ValidationErrorBody>(
    intakeUrl(id, '/submit'),
    { method: 'POST', allow: [409, 422] },
  );

  if (status === 409) {
    const errors = (body as Partial<ValidationErrorBody>).errors;
    return Array.isArray(errors) && errors.length > 0
      ? { outcome: 'email-taken', errors }
      : { outcome: 'not-draft' };
  }

  if (status === 422) return { outcome: 'invalid', errors: (body as ValidationErrorBody).errors };
  return { outcome: 'submitted', view: body as IntakeView };
}

/** The patient's own neutral view (2.3, 2.9): resume by id, or read the "received" status. Null for an id naming no intake at all. */
export async function getIntake(id: string, signal?: AbortSignal): Promise<IntakeView | null> {
  const { status, body } = await requestOutcome<IntakeView | { message: string }>(intakeUrl(id), {
    signal,
    allow: [404],
  });

  return status === 404 ? null : (body as IntakeView);
}

// === B6: the review screen (2.4, 2.9) =======================================

/** The review queue's URL (2.4). Built here for the same reason as `rowsUrl`. */
export const reviewUrl = `${apiBaseUrl}/review/intakes`;

/** The URL of one reviewed row and of the two presses against it (2.4). */
export function reviewIntakeUrl(id: string, path = ''): string {
  return `${reviewUrl}/${encodeURIComponent(id)}${path}`;
}

/** What the queue may be narrowed to (2.4). Both optional — absent means the backend's own default filter. */
export interface ReviewQueueFilter {
  readonly statuses?: readonly IntakeStatus[];
  readonly origin?: PatientOrigin;
}

/**
 * The review queue (2.4): the backend's default three statuses, or the
 * caller's own subset, narrowed by origin — oldest submission first, already
 * sorted by the endpoint.
 */
export async function getReviewQueue(
  filter: ReviewQueueFilter = {},
  signal?: AbortSignal,
): Promise<ReviewQueueEntry[]> {
  const params = new URLSearchParams();
  if (filter.statuses !== undefined && filter.statuses.length > 0) {
    params.set('status', filter.statuses.join(','));
  }
  if (filter.origin !== undefined) params.set('origin', filter.origin);

  const query = params.toString();
  return await requestJson<ReviewQueueEntry[]>(query === '' ? reviewUrl : `${reviewUrl}?${query}`, {
    signal,
  });
}

/**
 * One row expanded (2.4): answers by step, every rule result, status history.
 *
 * Read once per visit and re-read after every press, the same rule
 * `getRowDetail` and `getDuplicateDetail` follow: the screen's truth is what
 * the backend says it is.
 */
export async function getReviewDetail(id: string, signal?: AbortSignal): Promise<ReviewDetail> {
  return await requestJson<ReviewDetail>(reviewIntakeUrl(id), { signal });
}

export type ReviewStartOutcome =
  | { readonly outcome: 'started'; readonly status: IntakeStatus }
  /** The row is not `auto_*`, or names no patient at all (2.9: "409" either way). */
  | { readonly outcome: 'conflict' };

/** Start review (2.4): `auto_*` → `in_review`, `actor` recorded on the audit event. */
export async function startReview(id: string, actor: string): Promise<ReviewStartOutcome> {
  const { status, body } = await requestOutcome<ReviewStatusResponse>(reviewIntakeUrl(id, '/start'), {
    method: 'POST',
    body: { actor },
    allow: [409],
  });

  return status === 409 ? { outcome: 'conflict' } : { outcome: 'started', status: body.status };
}

export type ReviewDecideOutcome =
  | { readonly outcome: 'decided'; readonly status: IntakeStatus }
  | { readonly outcome: 'conflict' }
  | { readonly outcome: 'invalid'; readonly errors: FieldError[] };

/** Approve or reject (2.4): `in_review` → `approved`/`rejected`. A blank note is a 422 the caller reads back, not a client-side guess at the backend's own rule. */
export async function decideReview(
  id: string,
  decision: 'approved' | 'rejected',
  note: string,
  actor: string,
): Promise<ReviewDecideOutcome> {
  const { status, body } = await requestOutcome<ReviewStatusResponse | ValidationErrorBody>(
    reviewIntakeUrl(id, '/decide'),
    { method: 'POST', body: { decision, note, actor }, allow: [409, 422] },
  );

  if (status === 409) return { outcome: 'conflict' };
  if (status === 422) return { outcome: 'invalid', errors: (body as ValidationErrorBody).errors };
  return { outcome: 'decided', status: (body as ReviewStatusResponse).status };
}

// === B7: import on the rows screen (2.6, 2.9) ===============================

/** The URL of one legacy patient row's individual import (2.6). */
export function importPatientRowUrl(legacyId: string): string {
  return `${rowsUrl}/patient/${encodeURIComponent(legacyId)}/import`;
}

/** The bulk import URL (2.6). */
export const importPatientRowsUrl = `${rowsUrl}/import`;

export type ImportRowOutcome =
  | { readonly imported: true; readonly patientId: string; readonly intakeStatus: string }
  | { readonly imported: false; readonly errors: FieldError[] };

/**
 * Individual import (2.6): one row, through the same flow as an intake.
 *
 * The route's own failures do not carry a field breakdown the way bulk's
 * per-row `errors` does — a precondition failure is a 409 with a plain
 * reason, and even a 422 is one field error at a time from the same
 * `UnprocessableEntityException` shape every other endpoint uses. Both are
 * normalized here into bulk's own `{ field, value, reason }` list, so the
 * rows screen renders one failure list regardless of which button was
 * pressed — the 409 becomes `{ field: null, value: null, reason }`, exactly
 * the shape 2.6 already gives a bulk row that fails its precondition.
 */
export async function importPatientRow(legacyId: string, actor: string): Promise<ImportRowOutcome> {
  const { status, body } = await requestOutcome<
    LegacyPatientImportResponse | ValidationErrorBody | { message: string }
  >(importPatientRowUrl(legacyId), { method: 'POST', body: { actor }, allow: [409, 422] });

  if (status === 409) {
    const reason =
      typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : 'This row no longer qualifies for import.';
    return { imported: false, errors: [{ field: null, value: null, reason }] };
  }

  if (status === 422) {
    return { imported: false, errors: (body as ValidationErrorBody).errors };
  }

  const created = body as LegacyPatientImportResponse;
  return { imported: true, patientId: created.patientId, intakeStatus: created.intakeStatus };
}

/**
 * Bulk import (2.6): each row in its own transaction, one bad row never
 * blocking the rest. Always 200 — every row's own outcome is in the array,
 * imported and failed alike, so there is nothing here to normalize the way
 * `importPatientRow` has to.
 */
export async function importPatientRows(
  legacyIds: readonly string[],
  actor: string,
): Promise<BulkImportRowResult[]> {
  return await requestJson<BulkImportRowResult[]>(importPatientRowsUrl, {
    method: 'POST',
    body: { legacyIds, actor },
  });
}
