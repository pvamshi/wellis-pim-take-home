import type { HealthResponse } from './types';

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

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  let response: Response;

  try {
    response = await fetch(healthUrl, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (cause) {
    // The request never reached a response: the backend is not running, the
    // host does not resolve, or the browser blocked it. There is no status.
    if (isAbortError(cause)) throw cause;
    throw new ApiError(`Could not reach ${healthUrl}: ${describe(cause)}`, null, healthUrl);
  }

  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : '';
    throw new ApiError(
      `The backend answered ${response.status}${statusText}.`,
      response.status,
      healthUrl,
    );
  }

  try {
    return (await response.json()) as HealthResponse;
  } catch (cause) {
    if (isAbortError(cause)) throw cause;
    throw new ApiError(
      `The backend answered ${response.status} but the body is not JSON: ${describe(cause)}`,
      response.status,
      healthUrl,
    );
  }
}
