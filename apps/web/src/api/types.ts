/**
 * The backend's /health response.
 *
 * Deliberately permissive: the backend is being built in parallel and has not
 * fixed its response body, so the page renders whatever comes back instead of
 * depending on a field that may not exist.
 */
export type HealthResponse = { status?: string; [key: string]: unknown };
