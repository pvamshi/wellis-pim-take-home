import type {
  ApproveReport,
  HealthResponse,
  RowDeclineReport,
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
  /** GET by default; the four presses are POST, because all four write. */
  readonly method?: 'GET' | 'POST';
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
 * Approve on a whole rule (1.2.4, first scenario).
 *
 * No body at all: which rows move is decided by what is pending on the active
 * version, never by this caller.
 */
export async function approveRule(ruleId: string): Promise<ApproveReport> {
  return await requestJson<ApproveReport>(ruleUrl(ruleId, '/approve'), { method: 'POST' });
}

/** The tick on one row (1.2.4, second scenario). A row approve carries no reason. */
export async function approveRow(ruleId: string, row: RuleRowAddress): Promise<ApproveReport> {
  return await requestJson<ApproveReport>(ruleUrl(ruleId, '/rows/approve'), {
    method: 'POST',
    body: row,
  });
}

/**
 * Decline on a whole rule (1.2.6): its active version goes inactive with
 * `needsReview` true, so the rule leaves the list (1.2.1).
 *
 * No body, which the backend reads as 1.2.6's second scenario — declining with
 * no reason. The optional-reason dialog is T6.3's, and until it exists there is
 * no reason for this call to carry.
 */
export async function declineRule(ruleId: string): Promise<RuleDeclineReport> {
  return await requestJson<RuleDeclineReport>(ruleUrl(ruleId, '/decline'), { method: 'POST' });
}

/**
 * The cross on one row, unticked (1.2.7): that row is declined forever and the
 * rule is untouched.
 *
 * No reason and no "modify the rule" tick. Both are T6.3's — the ticked cross
 * is a different route (`/rows/revise`), so it cannot be reached by adding a
 * flag to this body.
 */
export async function declineRow(ruleId: string, row: RuleRowAddress): Promise<RowDeclineReport> {
  return await requestJson<RowDeclineReport>(ruleUrl(ruleId, '/rows/decline'), {
    method: 'POST',
    body: row,
  });
}
