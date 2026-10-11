import { Hono } from 'hono';
import { z } from 'zod';
import { addCreditsStatements, getEntitlements, removeCredits } from '../credits';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { forgetTier, requireAdmin } from '../middleware';
import { syncSubscription } from '../revenuecat';
import { clearSettingsCache, getSettings } from '../usage';
import { parseJson } from '../validate';

/**
 * Admin API used by the admin portal. Every route requires a valid Cloudflare Access
 * token, and every change is written to admin_audit with the admin's email.
 */
type AdminEnv = AppEnv & { Variables: { adminEmail: string } };
export const admin = new Hono<AdminEnv>();
admin.use('*', requireAdmin);

const DAY = 86_400_000;

function audit(c: { env: AdminEnv['Bindings']; get: (k: 'adminEmail') => string }, action: string, target: string | null, details: unknown) {
  return c.env.DB.prepare(
    'INSERT INTO admin_audit (id, admin_email, action, target_user_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(crypto.randomUUID(), c.get('adminEmail'), action, target, JSON.stringify(details ?? null), Date.now());
}

admin.get('/me', (c) => c.json({ email: c.get('adminEmail') }));

admin.get('/stats', async (c) => {
  const now = Date.now();
  const db = c.env.DB;
  const [users, subs, revenue, usage, passes] = await db.batch([
    db
      .prepare(
        `SELECT COUNT(*) AS total,
           SUM(CASE WHEN "createdAt" >= ? THEN 1 ELSE 0 END) AS last7,
           SUM(CASE WHEN "createdAt" >= ? THEN 1 ELSE 0 END) AS last30
         FROM "user"`,
      )
      .bind(new Date(now - 7 * DAY).toISOString(), new Date(now - 30 * DAY).toISOString()),
    db
      .prepare(
        `SELECT tier, product_id, COUNT(*) AS n FROM subscription
         WHERE expires_at > ? AND status IN ('active', 'cancelled', 'billing_issue') GROUP BY tier, product_id`,
      )
      .bind(now),
    db
      .prepare(
        `SELECT kind, COUNT(*) AS n, COALESCE(SUM(price_usd), 0) AS usd FROM purchase
         WHERE purchased_at >= ? AND refunded_at IS NULL AND (environment IS NULL OR environment = 'PRODUCTION') GROUP BY kind`,
      )
      .bind(now - 30 * DAY),
    db.prepare('SELECT day, requests, chars, credits, ocr_images FROM usage_global_daily ORDER BY day DESC LIMIT 30'),
    db.prepare(`SELECT COUNT(*) AS n FROM session_pass WHERE status = 'active' AND expires_at > ?`).bind(now),
  ]);
  return c.json({
    users: users!.results[0],
    activeSubscriptions: subs!.results,
    revenue30d: revenue!.results,
    usageByDay: usage!.results,
    activePasses: (passes!.results[0] as { n: number }).n,
    settings: await getSettings(db),
  });
});

admin.get('/users', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u."emailVerified" AS email_verified, u."createdAt" AS created_at, u.banned,
       s.tier AS sub_tier, s.status AS sub_status, s.expires_at AS sub_expires_at,
       (SELECT COALESCE(SUM(balance), 0) FROM credit_bucket b WHERE b.user_id = u.id AND (b.expires_at IS NULL OR b.expires_at > ?3)) AS balance
     FROM "user" u LEFT JOIN subscription s ON s.user_id = u.id
     WHERE (?1 = '' OR u.email LIKE ?2 ESCAPE '\\' OR u.name LIKE ?2 ESCAPE '\\' OR u.id = ?1)
     ORDER BY u."createdAt" DESC LIMIT ?4 OFFSET ?5`,
  )
    .bind(q, like, Date.now(), limit, offset)
    .all();
  return c.json({ users: results, limit, offset });
});

admin.get('/users/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const q = (sql: string) => db.prepare(sql).bind(id);
  const [user, accounts, sessions, purchases, passes, ledger, usage, auditRows] = await db.batch([
    q('SELECT id, name, email, "emailVerified" AS email_verified, "createdAt" AS created_at, banned, "banReason" AS ban_reason, "banExpires" AS ban_expires FROM "user" WHERE id = ?'),
    q('SELECT "providerId" AS provider, "createdAt" AS created_at FROM account WHERE "userId" = ?'),
    q('SELECT id, "createdAt" AS created_at, "expiresAt" AS expires_at, "userAgent" AS user_agent FROM session WHERE "userId" = ? ORDER BY "createdAt" DESC'),
    q('SELECT product_id, kind, store, environment, price_usd, purchased_at, refunded_at FROM purchase WHERE user_id = ? ORDER BY purchased_at DESC LIMIT 50'),
    q('SELECT id, status, activated_at, expires_at, created_at FROM session_pass WHERE user_id = ? ORDER BY created_at DESC'),
    q('SELECT bucket_kind, delta, reason, actor, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'),
    q('SELECT day, action, requests, chars, credits FROM usage_daily WHERE user_id = ? ORDER BY day DESC LIMIT 90'),
    q('SELECT admin_email, action, details, created_at FROM admin_audit WHERE target_user_id = ? ORDER BY created_at DESC LIMIT 50'),
  ]);
  if (!user!.results[0]) throw new ApiError(404, 'not_found', 'User not found.');
  return c.json({
    user: user!.results[0],
    signInMethods: accounts!.results,
    sessions: sessions!.results,
    entitlements: await getEntitlements(db, id),
    purchases: purchases!.results,
    passes: passes!.results,
    ledger: ledger!.results,
    usage: usage!.results,
    audit: auditRows!.results,
  });
});

const adjustCredits = z.object({
  amount: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, 'Amount cannot be zero'),
  reason: z.string().trim().min(3).max(200),
});

admin.post('/users/:id/credits', async (c) => {
  const id = await existingUser(c.env.DB, c.req.param('id'));
  const { amount, reason } = await parseJson(c, adjustCredits);
  const actor = c.get('adminEmail');
  let applied = amount;
  if (amount > 0) {
    await c.env.DB.batch([...addCreditsStatements(c.env.DB, id, 'grant', amount, 'admin_grant', reason, actor), audit(c, 'credits.grant', id, { amount, reason })]);
  } else {
    // Take from free credits first, then bought credits. Never below zero.
    const fromGrant = await removeCredits(c.env.DB, id, 'grant', -amount, 'admin_remove', reason, actor);
    const fromPurchased =
      fromGrant < -amount ? await removeCredits(c.env.DB, id, 'purchased', -amount - fromGrant, 'admin_remove', reason, actor) : 0;
    applied = -(fromGrant + fromPurchased);
    await audit(c, 'credits.remove', id, { requested: amount, applied, reason }).run();
  }
  return c.json({ applied, entitlements: await getEntitlements(c.env.DB, id) });
});

const grantPasses = z.object({ count: z.number().int().min(1).max(10), reason: z.string().trim().min(3).max(200) });

admin.post('/users/:id/passes', async (c) => {
  const id = await existingUser(c.env.DB, c.req.param('id'));
  const { count, reason } = await parseJson(c, grantPasses);
  const now = Date.now();
  await c.env.DB.batch([
    ...Array.from({ length: count }, () =>
      c.env.DB.prepare(`INSERT INTO session_pass (id, user_id, status, created_at) VALUES (?, ?, 'available', ?)`).bind(crypto.randomUUID(), id, now),
    ),
    audit(c, 'passes.grant', id, { count, reason }),
  ]);
  forgetTier(id);
  return c.json({ entitlements: await getEntitlements(c.env.DB, id) });
});

const ban = z.object({ reason: z.string().trim().min(3).max(200), days: z.number().int().min(1).max(3650).optional() });

admin.post('/users/:id/ban', async (c) => {
  const id = await existingUser(c.env.DB, c.req.param('id'));
  const { reason, days } = await parseJson(c, ban);
  const expires = days ? new Date(Date.now() + days * DAY).toISOString() : null;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE "user" SET banned = 1, "banReason" = ?, "banExpires" = ? WHERE id = ?').bind(reason, expires, id),
    c.env.DB.prepare('DELETE FROM session WHERE "userId" = ?').bind(id),
    audit(c, 'user.ban', id, { reason, days: days ?? null }),
  ]);
  return c.json({ ok: true });
});

admin.post('/users/:id/unban', async (c) => {
  const id = await existingUser(c.env.DB, c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE "user" SET banned = 0, "banReason" = NULL, "banExpires" = NULL WHERE id = ?').bind(id),
    audit(c, 'user.unban', id, null),
  ]);
  return c.json({ ok: true });
});

admin.post('/users/:id/sign-out', async (c) => {
  const id = await existingUser(c.env.DB, c.req.param('id'));
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM session WHERE "userId" = ?').bind(id), audit(c, 'user.sign_out_all', id, null)]);
  return c.json({ ok: true });
});

admin.post('/users/:id/sync-subscription', async (c) => {
  const id = await existingUser(c.env.DB, c.req.param('id'));
  await syncSubscription(c.env, id, null);
  forgetTier(id);
  await audit(c, 'subscription.sync', id, null).run();
  return c.json({ entitlements: await getEntitlements(c.env.DB, id) });
});

/** Deletes an account on the user's request (for example a privacy request by email). */
admin.delete('/users/:id', async (c) => {
  const id = await existingUser(c.env.DB, c.req.param('id'));
  const confirm = c.req.query('confirm');
  if (confirm !== id) throw new ApiError(400, 'bad_request', 'Pass ?confirm=<user id> to delete this account.');
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(id), audit(c, 'user.delete', id, null)]);
  return c.json({ ok: true });
});

admin.get('/purchases', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 500);
  const { results } = await c.env.DB.prepare(
    `SELECT p.product_id, p.kind, p.store, p.environment, p.price_usd, p.purchased_at, p.refunded_at, p.user_id, u.email
     FROM purchase p LEFT JOIN "user" u ON u.id = p.user_id ORDER BY p.purchased_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return c.json({ purchases: results });
});

admin.get('/audit', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 500);
  const { results } = await c.env.DB.prepare('SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT ?').bind(limit).all();
  return c.json({ entries: results });
});

admin.get('/settings', async (c) => c.json(await getSettings(c.env.DB, 0)));

const settingsBody = z.object({
  servicePaused: z.boolean().optional(),
  globalDailyCharCap: z.number().int().min(0).max(10_000_000_000).optional(),
  globalDailyOcrCap: z.number().int().min(0).max(100_000_000).optional(),
});

admin.put('/settings', async (c) => {
  const body = await parseJson(c, settingsBody);
  const now = Date.now();
  const actor = c.get('adminEmail');
  const rows: [string, string][] = [];
  if (body.servicePaused !== undefined) rows.push(['service_paused', body.servicePaused ? '1' : '0']);
  if (body.globalDailyCharCap !== undefined) rows.push(['global_daily_char_cap', String(body.globalDailyCharCap)]);
  if (body.globalDailyOcrCap !== undefined) rows.push(['global_daily_ocr_cap', String(body.globalDailyOcrCap)]);
  if (!rows.length) throw new ApiError(400, 'bad_request', 'Nothing to change.');
  await c.env.DB.batch([
    ...rows.map(([key, value]) =>
      c.env.DB.prepare(
        `INSERT INTO app_setting (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      ).bind(key, value, now, actor),
    ),
    audit(c, 'settings.update', null, body),
  ]);
  clearSettingsCache();
  return c.json(await getSettings(c.env.DB, 0));
});

async function existingUser(db: D1Database, id: string): Promise<string> {
  const row = await db.prepare('SELECT id FROM "user" WHERE id = ?').bind(id).first<{ id: string }>();
  if (!row) throw new ApiError(404, 'not_found', 'User not found.');
  return row.id;
}
