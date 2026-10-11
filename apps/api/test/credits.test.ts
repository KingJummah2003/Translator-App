import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ALLOWANCES } from '@translator/shared';
import { activatePass, addCreditsStatements, charge, getBalance, getEntitlements, getTier, refund } from '../src/credits';
import { DAY, bucketBalances, createUser, setSubscription } from './helpers';

const give = (userId: string, credits: number, kind: 'purchased' | 'grant' = 'purchased') =>
  env.DB.batch(addCreditsStatements(env.DB, userId, kind, credits, 'test', 'ref'));

describe('charge', () => {
  it('spends time-limited credits before bought credits', async () => {
    const user = await createUser();
    await give(user, 100, 'purchased');
    await give(user, 5, 'grant');
    await setSubscription(user, 'pro', Date.now() + 30 * DAY);

    await charge(env.DB, user, ALLOWANCES.proDailyCredits + 3, 'translate', 'r1');
    expect(await bucketBalances(user)).toEqual({ sub_daily: 0, grant: 2, purchased: 100 });
  });

  it('refuses when the balance is too low and changes nothing', async () => {
    const user = await createUser();
    await give(user, 3);
    await expect(charge(env.DB, user, 4, 'translate', 'r')).rejects.toMatchObject({ code: 'insufficient_credits' });
    expect(await getBalance(env.DB, user)).toBe(3);
  });

  it('never overspends when requests race', async () => {
    const user = await createUser();
    await give(user, 10);
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => charge(env.DB, user, 3, 'translate', `r${i}`)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(await getBalance(env.DB, user)).toBe(1);
  });

  it('refunds to the same buckets and records it in the ledger', async () => {
    const user = await createUser();
    await give(user, 10);
    const c = await charge(env.DB, user, 4, 'translate', 'r');
    await refund(env.DB, c, 'r');
    expect(await getBalance(env.DB, user)).toBe(10);
    const { results } = await env.DB.prepare('SELECT reason, delta FROM credit_ledger WHERE user_id = ? ORDER BY created_at, delta')
      .bind(user)
      .all();
    expect(results.map((r) => r.reason)).toEqual(expect.arrayContaining(['translate', 'refund']));
  });
});

describe('allowances', () => {
  it('gives VIP a fresh weekly allowance that does not roll over', async () => {
    const user = await createUser();
    await setSubscription(user, 'vip', Date.now() + 60 * DAY);
    const monday = Date.parse('2026-10-12T09:00:00Z');

    await charge(env.DB, user, 1000, 'translate', 'a', monday);
    expect(await getBalance(env.DB, user, monday)).toBe(ALLOWANCES.vipWeeklyCredits - 1000);

    const nextWeek = monday + 7 * DAY;
    const e = await getEntitlements(env.DB, user, nextWeek);
    expect(e.tier).toBe('vip');
    expect(e.balance).toBe(ALLOWANCES.vipWeeklyCredits);
  });

  it('gives Pro a daily allowance only while the subscription is active', async () => {
    const user = await createUser();
    await setSubscription(user, 'pro', Date.now() - DAY, 'expired');
    expect((await getEntitlements(env.DB, user)).balance).toBe(0);
    expect(await getTier(env.DB, user)).toBe('free');

    await setSubscription(user, 'pro', Date.now() + DAY, 'cancelled');
    expect((await getEntitlements(env.DB, user)).balance).toBe(ALLOWANCES.proDailyCredits);
  });
});

describe('session pass', () => {
  it('activates for 3 hours with its own credits, one at a time', async () => {
    const user = await createUser();
    const now = Date.now();
    for (let i = 0; i < 2; i++) {
      await env.DB.prepare(`INSERT INTO session_pass (id, user_id, status, created_at) VALUES (?, ?, 'available', ?)`)
        .bind(crypto.randomUUID(), user, now + i)
        .run();
    }
    const pass = await activatePass(env.DB, user, now);
    expect(pass.expiresAt - now).toBe(3 * 60 * 60 * 1000);
    await expect(activatePass(env.DB, user, now)).rejects.toMatchObject({ code: 'bad_request' });

    const e = await getEntitlements(env.DB, user, now);
    expect(e.tier).toBe('pass');
    expect(e.passesAvailable).toBe(1);
    expect(e.balance).toBe(150);
    expect(await getBalance(env.DB, user, pass.expiresAt + 1)).toBe(0);
  });

  it('reports a missing pass', async () => {
    const user = await createUser();
    await expect(activatePass(env.DB, user)).rejects.toMatchObject({ code: 'not_found' });
  });
});
