/** Calls the admin API (same origin; Cloudflare Access cookie is sent automatically). */
export class AdminError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function adminApi<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, body, headers, credentials: 'same-origin' });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new AdminError(res.status, data?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const fmtDate = (v: number | string | null | undefined, withTime = true) => {
  if (v === null || v === undefined || v === '') return '—';
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
};

export const fmtNum = (n: number | null | undefined) => (n ?? 0).toLocaleString();
export const fmtUsd = (n: number | null | undefined) => (n ?? 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
