import { env } from 'cloudflare:workers';

export const DAY = 86_400_000;

/** Inserts a bare user row (no sign-in) for unit tests of the billing logic. */
export async function createUser(email = `user-${crypto.randomUUID()}@example.com`): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(id, 'Test', email, now, now)
    .run();
  return id;
}

export async function setSubscription(userId: string, tier: 'pro' | 'vip', expiresAt: number, status = 'active') {
  await env.DB.prepare(
    `INSERT INTO subscription (user_id, tier, product_id, status, will_renew, expires_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET tier = excluded.tier, status = excluded.status, expires_at = excluded.expires_at`,
  )
    .bind(userId, tier, `${tier}_monthly`, status, expiresAt, Date.now())
    .run();
}

export async function bucketBalances(userId: string): Promise<Record<string, number>> {
  const { results } = await env.DB.prepare('SELECT kind, SUM(balance) AS b FROM credit_bucket WHERE user_id = ? GROUP BY kind')
    .bind(userId)
    .all<{ kind: string; b: number }>();
  return Object.fromEntries(results.map((r) => [r.kind, r.b]));
}
