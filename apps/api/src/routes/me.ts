import { Hono } from 'hono';
import { activatePass, getEntitlements } from '../credits';
import type { AppEnv } from '../env';
import { forgetTier } from '../middleware';

/** The signed-in user's own plan, balance and data. */
export const me = new Hono<AppEnv>();

me.get('/entitlements', async (c) => {
  return c.json(await getEntitlements(c.env.DB, c.get('user').id));
});

me.post('/pass/activate', async (c) => {
  const { id } = c.get('user');
  const pass = await activatePass(c.env.DB, id);
  forgetTier(id);
  return c.json({ expiresAt: new Date(pass.expiresAt).toISOString(), entitlements: await getEntitlements(c.env.DB, id) });
});

me.get('/ledger', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT bucket_kind AS kind, delta, reason, created_at FROM credit_ledger
     WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(c.get('user').id)
    .all();
  return c.json({ entries: results.map((r) => ({ ...r, created_at: new Date(r.created_at as number).toISOString() })) });
});

/** Everything we hold about the user, as a JSON download (GDPR right of access). */
me.get('/export', async (c) => {
  const id = c.get('user').id;
  const db = c.env.DB;
  const q = (sql: string) => db.prepare(sql).bind(id);
  const [user, accounts, sessions, subscription, purchases, passes, buckets, ledger, usage] = await db.batch([
    q('SELECT id, name, email, "emailVerified", "createdAt", "updatedAt" FROM "user" WHERE id = ?'),
    q('SELECT "providerId", "createdAt" FROM account WHERE "userId" = ?'),
    q('SELECT "createdAt", "expiresAt", "userAgent" FROM session WHERE "userId" = ?'),
    q('SELECT tier, product_id, store, status, will_renew, expires_at FROM subscription WHERE user_id = ?'),
    q('SELECT product_id, kind, store, purchased_at, refunded_at FROM purchase WHERE user_id = ?'),
    q('SELECT status, activated_at, expires_at, created_at FROM session_pass WHERE user_id = ?'),
    q('SELECT kind, balance, expires_at FROM credit_bucket WHERE user_id = ?'),
    q('SELECT bucket_kind, delta, reason, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at'),
    q('SELECT day, action, requests, chars, credits FROM usage_daily WHERE user_id = ? ORDER BY day'),
  ]);
  const body = {
    exportedAt: new Date().toISOString(),
    note: 'We never store the text you translate. Translation history lives only on your device.',
    user: user!.results[0] ?? null,
    signInMethods: accounts!.results,
    sessions: sessions!.results,
    subscription: subscription!.results[0] ?? null,
    purchases: purchases!.results,
    sessionPasses: passes!.results,
    creditBuckets: buckets!.results,
    creditHistory: ledger!.results,
    dailyUsage: usage!.results,
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="my-translator-data.json"',
      'cache-control': 'no-store',
    },
  });
});
