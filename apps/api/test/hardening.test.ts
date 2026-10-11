import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALLOWANCES } from '@translator/shared';
import { activatePass, addCreditsStatements, charge, getBalance, getEntitlements } from '../src/credits';
import { handleEvent } from '../src/revenuecat';
import { bucketBalances, createUser, DAY, setSubscription } from './helpers';

/** Regression tests for the security review findings. */

const API = 'http://localhost:8790';

function webhook(event: Record<string, unknown>) {
  return exports.default.fetch(`${API}/webhooks/revenuecat`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-webhook-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ api_version: '1.0', event: { id: crypto.randomUUID(), ...event } }),
  });
}

async function signIn(email: string, ip: string): Promise<string> {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' ')));
  const headers = { 'content-type': 'application/json', origin: API, 'cf-connecting-ip': ip };
  await exports.default.fetch(`${API}/api/auth/email-otp/send-verification-otp`, { method: 'POST', headers, body: JSON.stringify({ email, type: 'sign-in' }) });
  let otp: string | undefined;
  for (let i = 0; i < 50 && !otp; i++) {
    otp = logs.join('\n').match(/^\s+(\d{6})$/m)?.[1];
    if (!otp) await new Promise((r) => setTimeout(r, 20));
  }
  spy.mockRestore();
  const res = await exports.default.fetch(`${API}/api/auth/sign-in/email-otp`, { method: 'POST', headers, body: JSON.stringify({ email, otp }) });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

afterEach(() => vi.restoreAllMocks());

describe('subscription allowances follow the subscription', () => {
  it('moves the current VIP week on TRANSFER instead of granting it again', async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    await setSubscription(a, 'vip', Date.now() + 30 * DAY);
    await charge(env.DB, a, 1000, 'translate', 'r');
    expect(await getBalance(env.DB, a)).toBe(ALLOWANCES.vipWeeklyCredits - 1000);

    await webhook({ type: 'TRANSFER', app_user_id: b, transferred_from: [a], transferred_to: [b] });
    expect(await getBalance(env.DB, a)).toBe(0);
    expect((await getEntitlements(env.DB, a)).tier).toBe('free');

    await setSubscription(b, 'vip', Date.now() + 30 * DAY);
    expect(await getBalance(env.DB, b)).toBe(ALLOWANCES.vipWeeklyCredits - 1000);

    await webhook({ type: 'TRANSFER', app_user_id: c, transferred_from: [b], transferred_to: [c] });
    await setSubscription(c, 'vip', Date.now() + 30 * DAY);
    expect(await getBalance(env.DB, b)).toBe(0);
    expect(await getBalance(env.DB, c)).toBe(ALLOWANCES.vipWeeklyCredits - 1000);
  });

  it('removes the remaining allowance when the subscription expires', async () => {
    const u = await createUser();
    const base = { app_user_id: u, product_id: 'pro_monthly', entitlement_ids: ['pro'] };
    await webhook({ ...base, type: 'INITIAL_PURCHASE', transaction_id: `t-${u}`, expiration_at_ms: Date.now() + DAY });
    expect(await getBalance(env.DB, u)).toBe(0);
    await getEntitlements(env.DB, u); // creates today's allowance
    expect(await getBalance(env.DB, u)).toBe(ALLOWANCES.proDailyCredits);
    await webhook({ ...base, type: 'EXPIRATION', expiration_at_ms: Date.now() - 1000 });
    expect(await getBalance(env.DB, u)).toBe(0);
  });
});

describe('refunds and passes are atomic', () => {
  it('claws back a refunded credit pack exactly once, even with duplicate deliveries', async () => {
    const u = await createUser();
    const tx = `refund-${u}`;
    await webhook({ type: 'NON_RENEWING_PURCHASE', app_user_id: u, product_id: 'credits_100', transaction_id: tx });
    await env.DB.batch(addCreditsStatements(env.DB, u, 'purchased', 50, 'test', 'extra'));
    const refund = { type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', app_user_id: u, product_id: 'credits_100', transaction_id: tx };
    await Promise.all([webhook(refund), webhook(refund), webhook(refund)]);
    expect(await bucketBalances(u)).toEqual({ purchased: 50 });
  });

  it('starts only one pass and writes one grant when activations race', async () => {
    const u = await createUser();
    for (let i = 0; i < 2; i++) {
      await env.DB.prepare(`INSERT INTO session_pass (id, user_id, status, created_at) VALUES (?, ?, 'available', ?)`).bind(crypto.randomUUID(), u, i).run();
    }
    const results = await Promise.allSettled([activatePass(env.DB, u), activatePass(env.DB, u), activatePass(env.DB, u)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const ledger = await env.DB.prepare(`SELECT SUM(delta) AS total FROM credit_ledger WHERE user_id = ? AND reason = 'pass_activated'`).bind(u).first<{ total: number }>();
    expect(ledger!.total).toBe(150);
    expect((await getEntitlements(env.DB, u)).passesAvailable).toBe(1);
  });
});

describe('sandbox purchases', () => {
  it('ignores App Store / Play test purchases in production unless the user is a tester', async () => {
    const u = await createUser();
    const prod = { ...env, ENVIRONMENT: 'production' as const, REVENUECAT_SECRET_KEY: undefined };
    const event = { id: 'x', type: 'NON_RENEWING_PURCHASE', app_user_id: u, product_id: 'credits_500', transaction_id: `sb-${u}`, environment: 'SANDBOX' as const };
    expect(await handleEvent(prod, event)).toBe('ignored');
    expect(await handleEvent({ ...prod, SANDBOX_USER_IDS: `someone,${u}` }, event)).toBe('processed');
    expect(await bucketBalances(u)).toEqual({ purchased: 500 });
  });

  it('refuses to trust webhook bodies for subscriptions in production without the RevenueCat key', async () => {
    const u = await createUser();
    const prod = { ...env, ENVIRONMENT: 'production' as const, REVENUECAT_SECRET_KEY: undefined };
    await expect(
      handleEvent(prod, { id: 'y', type: 'INITIAL_PURCHASE', app_user_id: u, product_id: 'vip_monthly', entitlement_ids: ['vip'], expiration_at_ms: Date.now() + DAY }),
    ).rejects.toThrow(/REVENUECAT_SECRET_KEY/);
  });
});

describe('access control', () => {
  it('signs a banned user out immediately', async () => {
    const cookie = await signIn(`ban-${crypto.randomUUID()}@example.com`, '203.0.113.10');
    const me = await exports.default.fetch(`${API}/v1/me/entitlements`, { headers: { cookie } });
    expect(me.status).toBe(200);
    const row = await env.DB.prepare(`SELECT "userId" AS id FROM session ORDER BY "createdAt" DESC LIMIT 1`).first<{ id: string }>();
    const ban = await exports.default.fetch(`${API}/admin/users/${row!.id}/ban`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'test ban' }),
    });
    expect(ban.status).toBe(200);
    expect((await exports.default.fetch(`${API}/v1/me/entitlements`, { headers: { cookie } })).status).toBe(401);
  });

  it('refuses the admin API off localhost when Access is not configured', async () => {
    const res = await exports.default.fetch('https://api.example.com/admin/stats');
    expect(res.status).toBe(403);
  });

  it("blocks Better Auth's built-in admin endpoints", async () => {
    const res = await exports.default.fetch(`${API}/api/auth/admin/list-users`, { headers: { origin: API } });
    expect(res.status).toBe(404);
  });

  it('rejects oversized request bodies', async () => {
    const cookie = await signIn(`big-${crypto.randomUUID()}@example.com`, '203.0.113.11');
    const res = await exports.default.fetch(`${API}/v1/translate`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'a'.repeat(200_000), source: 'en', target: 'fr' }),
    });
    expect(res.status).toBe(413);
  });
});

describe('pricing and free credits', () => {
  it('charges camera text translation like typed text', async () => {
    const cookie = await signIn(`ocr-${crypto.randomUUID()}@example.com`, '203.0.113.12');
    const res = await exports.default.fetch(`${API}/v1/ocr`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ image: btoa('fake-image'), target: 'ar' }),
    });
    const body = await res.json<{ charged: number; translation: string; balance: number }>();
    expect(body.translation).toBe('[ar] Sample text from image');
    expect(body.charged).toBe(3); // 2 to read the photo + 1 to translate the text
    expect(body.balance).toBe(ALLOWANCES.welcomeCredits - 3);
  });

  it('gives welcome credits once per email address, even after deleting the account', async () => {
    const id = crypto.randomUUID().slice(0, 8);
    const first = await signIn(`welcome.${id}@gmail.com`, '203.0.113.20');
    const me1 = await (await exports.default.fetch(`${API}/v1/me/entitlements`, { headers: { cookie: first } })).json<{ balance: number }>();
    expect(me1.balance).toBe(ALLOWANCES.welcomeCredits);

    await env.DB.prepare('DELETE FROM "user" WHERE email = ?').bind(`welcome.${id}@gmail.com`).run();
    const again = await signIn(`welcome${id}+again@gmail.com`, '203.0.113.21');
    const me2 = await (await exports.default.fetch(`${API}/v1/me/entitlements`, { headers: { cookie: again } })).json<{ balance: number }>();
    expect(me2.balance).toBe(0);
  });
});
