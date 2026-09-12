import type { HealthResponse, RulesListResponse } from './types';

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

/**
 * One GET that answers with JSON, or an `ApiError` saying why it did not.
 *
 * Every endpoint this app reads fails in the same three ways — unreachable, a
 * non-2xx answer, a body that is not JSON — so the classification lives once
 * here rather than being copied per call. The caller supplies the URL, which is
 * both what is fetched and what the error carries, so an `ApiError` always
 * names the address that produced it.
 *
 * The body is asserted, not validated: the backend owns the shape and the
 * types in `./types.ts` restate it. A response that disagrees is a backend bug,
 * not a case this layer can usefully recover from.
 */
async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
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
  return await requestJson<HealthResponse>(healthUrl, signal);
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
  return await requestJson<RulesListResponse>(rulesUrl, signal);
}
