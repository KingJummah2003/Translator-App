import type { ApiErrorBody } from '@translator/shared';
import { authClient } from './auth';
import { API_URL } from './config';

type ApiErrorCode = ApiErrorBody['error']['code'];

/**
 * A failed API call. `code` is stable and is what the UI maps to a localized message
 * (errorMessage in errors.ts); `message` is English detail for logs, never for display.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'insufficient_credits',
  'rate_limited',
  'too_large',
  'service_paused',
  'upstream_error',
  'internal',
]);

/** Best guess when the body is not our JSON error shape (proxy pages, HTML 502s and so on). */
function codeForStatus(status: number): ApiErrorCode {
  if (status === 400 || status === 422) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'insufficient_credits';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'service_paused';
  if (status === 502 || status === 504) return 'upstream_error';
  return 'internal';
}

/** Android's fetch has no timeout at all, so a dead network would otherwise hang forever. */
const TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 180_000;

export type ApiInit = RequestInit & { json?: unknown; timeoutMs?: number };

/** Calls our API with the session cookie. Throws ApiError (with a stable code) on failure. */
export async function api(path: string, init: ApiInit = {}): Promise<Response> {
  const { json, timeoutMs, signal: callerSignal, ...rest } = init;
  let cookie: string | null | undefined;
  try {
    cookie = await authClient.getCookie();
  } catch {
    cookie = null; // Keychain unavailable: call anonymously, the API answers 401 where it matters.
  }
  const headers = new Headers(rest.headers);
  if (cookie) headers.set('cookie', cookie);
  let body = rest.body;
  if (json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(json);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    timeoutMs ?? (body instanceof FormData ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS),
  );
  const forwardAbort = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener('abort', forwardAbort);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...rest, body, headers, credentials: 'omit', signal: controller.signal });
  } catch (err) {
    // The caller cancelled: let them see their own AbortError and ignore it.
    if (callerSignal?.aborted && !timedOut) throw err;
    throw new ApiError(0, 'network', timedOut ? 'Request timed out' : 'No connection to the server');
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', forwardAbort);
  }

  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    const code = parsed?.error?.code;
    throw new ApiError(
      res.status,
      code && KNOWN_CODES.has(code) ? code : codeForStatus(res.status),
      parsed?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return res;
}

export async function apiJson<T>(path: string, init: ApiInit = {}): Promise<T> {
  const res = await api(path, init);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, 'internal', 'Invalid JSON in response');
  }
}
