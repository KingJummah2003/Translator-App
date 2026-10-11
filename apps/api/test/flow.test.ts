import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALLOWANCES } from '@translator/shared';

const API = 'http://localhost:8787';

/** Signs in with a one-time email code, reading the code from the dev email log. */
async function signIn(email: string): Promise<string> {
  // Each test user gets its own address so the per-IP sign-in limits don't interfere.
  const ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => void logs.push(args.join(' ')));
  const send = await exports.default.fetch(`${API}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: API, 'cf-connecting-ip': ip },
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  expect(send.status).toBe(200);
  let otp: string | undefined;
  for (let i = 0; i < 50 && !otp; i++) {
    otp = logs.join('\n').match(/^\s+(\d{6})$/m)?.[1];
    if (!otp) await new Promise((r) => setTimeout(r, 20));
  }
  spy.mockRestore();
  expect(otp).toBeDefined();

  const res = await exports.default.fetch(`${API}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: API, 'cf-connecting-ip': ip },
    body: JSON.stringify({ email, otp }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.getSetCookie().map((c: string) => c.split(';')[0]).join('; ');
  expect(cookie).toContain('session_token');
  return cookie;
}

const call = (cookie: string, path: string, init: RequestInit = {}) =>
  exports.default.fetch(`${API}${path}`, { ...init, headers: { cookie, 'content-type': 'application/json', ...init.headers } });

afterEach(() => vi.restoreAllMocks());

describe('signed-in flow', () => {
  it('requires a session for paid features', async () => {
    const res = await exports.default.fetch(`${API}/v1/me/entitlements`);
    expect(res.status).toBe(401);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('signs up with an email code, gets welcome credits and translates', async () => {
    const cookie = await signIn(`flow-${crypto.randomUUID()}@example.com`);

    const ent = await (await call(cookie, '/v1/me/entitlements')).json<{ tier: string; balance: number }>();
    expect(ent).toMatchObject({ tier: 'free', balance: ALLOWANCES.welcomeCredits });

    const res = await call(cookie, '/v1/translate', { method: 'POST', body: JSON.stringify({ text: 'Hello', source: 'auto', target: 'ar' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ translation: '[ar] Hello', detectedSource: 'en', charged: 1, balance: ALLOWANCES.welcomeCredits - 1 });
  });

  it('limits how often one address can request sign-in codes', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await exports.default.fetch(`${API}/api/auth/email-otp/send-verification-otp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: API, 'cf-connecting-ip': '192.0.2.77' },
        body: JSON.stringify({ email: `spam-${i}@example.com`, type: 'sign-in' }),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it('validates input and reports insufficient credits', async () => {
    const cookie = await signIn(`poor-${crypto.randomUUID()}@example.com`);
    const bad = await call(cookie, '/v1/translate', { method: 'POST', body: JSON.stringify({ text: 'x', source: 'xx', target: 'ar' }) });
    expect(bad.status).toBe(400);

    const big = 'a'.repeat(5000);
    for (let i = 0; i < 2; i++) {
      await call(cookie, '/v1/translate', { method: 'POST', body: JSON.stringify({ text: big, source: 'en', target: 'fr' }) });
    }
    const res = await call(cookie, '/v1/translate', { method: 'POST', body: JSON.stringify({ text: big, source: 'en', target: 'fr' }) });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: { code: 'insufficient_credits' } });
  });

  it('translates a Word document and keeps it a Word document', async () => {
    const cookie = await signIn(`doc-${crypto.randomUUID()}@example.com`);
    const { zipSync, strToU8, unzipSync, strFromU8 } = await import('fflate');
    const docx = zipSync({
      'word/document.xml': strToU8('<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Good morning</w:t></w:r></w:p></w:body></w:document>'),
    });
    const form = new FormData();
    form.set('file', new File([docx], 'note.docx'));
    form.set('source', 'en');
    form.set('target', 'ar');
    const res = await exports.default.fetch(`${API}/v1/documents`, { method: 'POST', headers: { cookie }, body: form });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('note.ar.docx');
    const xml = strFromU8(unzipSync(new Uint8Array(await res.arrayBuffer()))['word/document.xml']!);
    expect(xml).toContain('<w:pPr><w:bidi/></w:pPr>');
    expect(xml).toContain('[ar] Good morning');
  });

  it('stops cloud calls when the admin pauses the service', async () => {
    const cookie = await signIn(`pause-${crypto.randomUUID()}@example.com`);
    const admin = await exports.default.fetch(`${API}/admin/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ servicePaused: true }),
    });
    expect(admin.status).toBe(200);
    const res = await call(cookie, '/v1/translate', { method: 'POST', body: JSON.stringify({ text: 'Hi', source: 'en', target: 'fr' }) });
    expect(res.status).toBe(503);
    await exports.default.fetch(`${API}/admin/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ servicePaused: false }) });
    const audit = await env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'settings.update'`).first<{ n: number }>();
    expect(audit!.n).toBeGreaterThanOrEqual(2);
  });

  it('exports the user data without any translated text', async () => {
    const cookie = await signIn(`export-${crypto.randomUUID()}@example.com`);
    await call(cookie, '/v1/translate', { method: 'POST', body: JSON.stringify({ text: 'secret words', source: 'en', target: 'de' }) });
    const res = await call(cookie, '/v1/me/export');
    const text = await res.text();
    expect(text).not.toContain('secret words');
    expect(JSON.parse(text).dailyUsage[0]).toMatchObject({ action: 'translate', requests: 1, chars: 12 });
  });
});
