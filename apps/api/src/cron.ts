import type { Env } from './env';

const DAY = 86_400_000;

/**
 * Daily housekeeping (03:00 UTC). Keeps the database small and drops data we no longer
 * need (data minimisation): expired sessions and codes, empty expired credit buckets,
 * old webhook receipts and old per-user usage counters.
 */
export async function dailyCleanup(env: Env, now = Date.now()): Promise<void> {
  const db = env.DB;
  const iso = (ms: number) => new Date(ms).toISOString();
  const results = await db.batch([
    db.prepare('DELETE FROM session WHERE "expiresAt" < ?').bind(iso(now)),
    db.prepare('DELETE FROM verification WHERE "expiresAt" < ?').bind(iso(now)),
    db.prepare('DELETE FROM "rateLimit" WHERE "lastRequest" < ?').bind(now - DAY),
    db.prepare('DELETE FROM credit_bucket WHERE expires_at IS NOT NULL AND expires_at < ?').bind(now - 7 * DAY),
    db.prepare(`UPDATE subscription SET status = 'expired' WHERE status != 'expired' AND expires_at < ?`).bind(now - 3 * DAY),
    db.prepare('DELETE FROM webhook_event WHERE received_at < ?').bind(now - 90 * DAY),
    db.prepare('DELETE FROM usage_daily WHERE day < ?').bind(iso(now - 400 * DAY).slice(0, 10)),
  ]);
  const removed = results.map((r) => r.meta.changes);
  console.log(`daily cleanup removed/updated rows: ${removed.join(',')}`);
}
