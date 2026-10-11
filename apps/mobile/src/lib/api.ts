import type { ApiErrorBody } from '@translator/shared';
import { authClient } from './auth';
import { API_URL } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorBody['error']['code'] | 'network',
    message: string,
  ) {
    super(message);
  }
}

/** Calls our API with the session cookie. Throws ApiError with a message safe to show. */
export async function api(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const cookie = await authClient.getCookie();
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, body, headers, credentials: 'omit' });
  } catch {
    throw new ApiError(0, 'network', 'No connection to the server.');
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, err?.error.code ?? 'internal', err?.error.message ?? `Request failed (${res.status})`);
  }
  return res;
}

export async function apiJson<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  return (await api(path, init)).json() as Promise<T>;
}
