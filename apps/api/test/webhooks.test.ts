import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { getEntitlements } from '../src/credits';
import { DAY, bucketBalances, createUser } from './helpers';

function post(event: Record<string, unknown>, auth = 'Bearer test-webhook-secret') {
  return exports.default.fetch('http://api.test/webhooks/revenuecat', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({ api_version: '1.0', event: { id: crypto.randomUUID(), ...event } }),
  });
}

describe('RevenueCat webhook', () => {
  it('rejects a wrong secret', async () => {
    const res = await post({ type: 'TEST', app_user_id: 'x' }, 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('grants a credit pack once per transaction', async () => {
    const user = await createUser();
    const purchase = { type: 'NON_RENEWING_PURCHASE', app_user_id: user, product_id: 'credits_500', transaction_id: `t-${user}`, store: 'APP_STORE', environment: 'SANDBOX', price: 4.99 };
    expect((await post(purchase)).status).toBe(200);
    expect((await post(purchase)).status).toBe(200); // same transaction, new event id
    expect(await bucketBalances(user)).toEqual({ purchased: 500 });
    expect((await getEntitlements(env.DB, user)).tier).toBe('credits');
  });

  it('ignores a repeated event id', async () => {
    const user = await createUser();
    const id = crypto.randomUUID();
    const body = { id, type: 'NON_RENEWING_PURCHASE', app_user_id: user, product_id: 'credits_100', transaction_id: `a-${user}` };
    await post(body);
    const res = await post(body);
    expect(await res.json()).toMatchObject({ duplicate: true });
  });

  it('claws back unspent credits after a refund', async () => {
    const user = await createUser();
    const tx = `r-${user}`;
    await post({ type: 'NON_RENEWING_PURCHASE', app_user_id: user, product_id: 'credits_100', transaction_id: tx });
    await env.DB.prepare(`UPDATE credit_bucket SET balance = 40 WHERE user_id = ?`).bind(user).run();
    await post({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', app_user_id: user, product_id: 'credits_100', transaction_id: tx, price: -0.99 });
    expect(await bucketBalances(user)).toEqual({ purchased: 0 });
  });

  it('adds a session pass that the user can start later', async () => {
    const user = await createUser();
    await post({ type: 'NON_RENEWING_PURCHASE', app_user_id: user, product_id: 'pass_3h', transaction_id: `p-${user}` });
    const e = await getEntitlements(env.DB, user);
    expect(e.passesAvailable).toBe(1);
    expect(e.tier).toBe('credits');
  });

  it('tracks a subscription through renewal, cancellation and expiry', async () => {
    const user = await createUser();
    const base = { app_user_id: user, product_id: 'vip_monthly:monthly', entitlement_ids: ['vip'], store: 'PLAY_STORE' };
    const exp = Date.now() + 30 * DAY;
    await post({ ...base, type: 'INITIAL_PURCHASE', transaction_id: `s1-${user}`, expiration_at_ms: exp });
    let e = await getEntitlements(env.DB, user);
    expect(e.tier).toBe('vip');
    expect(e.subscription).toMatchObject({ productId: 'vip_monthly', willRenew: true });

    await post({ ...base, type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', expiration_at_ms: exp });
    e = await getEntitlements(env.DB, user);
    expect(e.tier).toBe('vip');
    expect(e.subscription?.willRenew).toBe(false);

    await post({ ...base, type: 'EXPIRATION', expiration_at_ms: Date.now() - 1000 });
    expect((await getEntitlements(env.DB, user)).tier).toBe('free');
  });

  it('ignores anonymous and unknown users', async () => {
    const res = await post({ type: 'NON_RENEWING_PURCHASE', app_user_id: '$RCAnonymousID:abc', product_id: 'credits_100', transaction_id: 'anon' });
    expect(await res.json()).toMatchObject({ status: 'ignored' });
  });
});
