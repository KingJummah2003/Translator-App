import {
  ALLOWANCES,
  BUCKET_SPEND_ORDER,
  PRODUCTS,
  RATE_LIMITS_PER_MINUTE,
  startOfDayUtc,
  startOfWeekUtc,
  type BucketKind,
  type Entitlements,
  type Tier,
} from '@translator/shared';
import { ApiError } from './errors';

/**
 * The credit engine. All balances live in D1 and every change is written together with a
 * ledger row in one atomic batch. `credit_bucket.balance` has CHECK (balance >= 0), so two
 * requests racing for the same credits cannot overspend: the loser's batch fails and is
 * retried against the fresh balance.
 */

const DAY_MS = 86_400_000;
const NEVER = Number.MAX_SAFE_INTEGER;

interface BucketRow {
  id: string;
  kind: BucketKind;
  balance: number;
  expires_at: number | null;
}

interface SubscriptionRow {
  tier: 'pro' | 'vip';
  product_id: string;
  status: string;
  will_renew: number;
  expires_at: number;
}

export interface Charge {
  userId: string;
  amount: number;
  parts: { bucketId: string; kind: BucketKind; amount: number }[];
}

export async function getActiveSubscription(db: D1Database, userId: string, now = Date.now()) {
  return db
    .prepare(
      `SELECT tier, product_id, status, will_renew, expires_at FROM subscription
       WHERE user_id = ? AND expires_at > ? AND status IN ('active', 'cancelled', 'billing_issue')`,
    )
    .bind(userId, now)
    .first<SubscriptionRow>();
}

/**
 * Subscribers' allowances are created lazily the first time they are needed in a new day
 * (Pro) or week (VIP). That gives the weekly VIP reset without touching every user from a
 * cron job, and unused credits simply expire with their bucket.
 */
export async function ensureAllowanceBuckets(db: D1Database, userId: string, now = Date.now()): Promise<void> {
  const sub = await getActiveSubscription(db, userId, now);
  if (!sub) return;
  const at = new Date(now);
  if (sub.tier === 'pro') {
    const start = startOfDayUtc(at).getTime();
    await insertAllowance(db, userId, 'sub_daily', ALLOWANCES.proDailyCredits, start + DAY_MS, isoDay(start), now);
  } else {
    const start = startOfWeekUtc(at).getTime();
    await insertAllowance(db, userId, 'vip_weekly', ALLOWANCES.vipWeeklyCredits, start + 7 * DAY_MS, isoDay(start), now);
  }
}

async function insertAllowance(
  db: D1Database,
  userId: string,
  kind: BucketKind,
  credits: number,
  expiresAt: number,
  periodKey: string,
  now: number,
) {
  const id = crypto.randomUUID();
  const inserted = await db
    .prepare(
      `INSERT INTO credit_bucket (id, user_id, kind, balance, expires_at, period_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, kind, period_key) DO NOTHING`,
    )
    .bind(id, userId, kind, credits, expiresAt, periodKey, now)
    .run();
  if (inserted.meta.changes > 0) {
    await ledger(db, userId, kind, credits, kind === 'vip_weekly' ? 'weekly_reset' : 'daily_allowance', periodKey).run();
  }
}

async function spendableBuckets(db: D1Database, userId: string, now: number): Promise<BucketRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, balance, expires_at FROM credit_bucket
       WHERE user_id = ? AND balance > 0 AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .bind(userId, now)
    .all<BucketRow>();
  return results.sort(
    (a, b) =>
      (a.expires_at ?? NEVER) - (b.expires_at ?? NEVER) || BUCKET_SPEND_ORDER[a.kind] - BUCKET_SPEND_ORDER[b.kind],
  );
}

export async function getBalance(db: D1Database, userId: string, now = Date.now()): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(balance), 0) AS total FROM credit_bucket
       WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .bind(userId, now)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/** Takes `amount` credits, soonest-expiring first. Throws insufficient_credits if short. */
export async function charge(
  db: D1Database,
  userId: string,
  amount: number,
  reason: string,
  ref: string,
  now = Date.now(),
): Promise<Charge> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error(`Invalid charge amount ${amount}`);
  await ensureAllowanceBuckets(db, userId, now);

  for (let attempt = 0; attempt < 3; attempt++) {
    const buckets = await spendableBuckets(db, userId, now);
    const parts: Charge['parts'] = [];
    let remaining = amount;
    for (const b of buckets) {
      if (remaining === 0) break;
      const take = Math.min(b.balance, remaining);
      parts.push({ bucketId: b.id, kind: b.kind, amount: take });
      remaining -= take;
    }
    if (remaining > 0) {
      throw new ApiError(402, 'insufficient_credits', `This needs ${amount} credits; you have ${amount - remaining}.`);
    }
    try {
      await db.batch(
        parts.flatMap((p) => [
          db.prepare('UPDATE credit_bucket SET balance = balance - ? WHERE id = ?').bind(p.amount, p.bucketId),
          ledger(db, userId, p.kind, -p.amount, reason, ref),
        ]),
      );
      return { userId, amount, parts };
    } catch (err) {
      if (!isCheckViolation(err)) throw err;
      // Another request spent these credits first; re-read and try again.
    }
  }
  throw new ApiError(409, 'insufficient_credits', 'Your balance changed during the request. Please try again.');
}

/** Gives back a charge when the translation provider failed after we charged. */
export async function refund(db: D1Database, c: Charge, ref: string): Promise<void> {
  await db.batch(
    c.parts.flatMap((p) => [
      db.prepare('UPDATE credit_bucket SET balance = balance + ? WHERE id = ?').bind(p.amount, p.bucketId),
      ledger(db, c.userId, p.kind, p.amount, 'refund', ref),
    ]),
  );
}

/** Adds credits to the user's permanent bucket (credit packs, grants, admin adjustments). */
export function addCreditsStatements(
  db: D1Database,
  userId: string,
  kind: 'purchased' | 'grant',
  credits: number,
  reason: string,
  ref: string | null,
  actor: string | null = null,
  now = Date.now(),
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO credit_bucket (id, user_id, kind, balance, expires_at, period_key, created_at)
         VALUES (?, ?, ?, ?, NULL, 'main', ?)
         ON CONFLICT (user_id, kind, period_key) DO UPDATE SET balance = balance + excluded.balance`,
      )
      .bind(crypto.randomUUID(), userId, kind, credits, now),
    ledger(db, userId, kind, credits, reason, ref, actor, now),
  ];
}

/**
 * Removes up to `credits` from a permanent bucket (refunded credit pack, admin correction).
 * Never goes below zero: credits already spent before a refund cannot be taken back.
 */
export async function removeCredits(
  db: D1Database,
  userId: string,
  kind: 'purchased' | 'grant',
  credits: number,
  reason: string,
  ref: string,
  actor: string | null = null,
): Promise<number> {
  const row = await db
    .prepare(`SELECT id, balance FROM credit_bucket WHERE user_id = ? AND kind = ? AND period_key = 'main'`)
    .bind(userId, kind)
    .first<{ id: string; balance: number }>();
  const take = Math.min(row?.balance ?? 0, credits);
  if (!row || take === 0) return 0;
  await db.batch([
    db.prepare('UPDATE credit_bucket SET balance = balance - ? WHERE id = ?').bind(take, row.id),
    ledger(db, userId, kind, -take, reason, ref, actor),
  ]);
  return take;
}

/* ------------------------------------------------------------------ subscription allowances */

const ALLOWANCE_KINDS = `('sub_daily', 'vip_weekly')`;

/**
 * Removes the unspent daily/weekly allowance when a subscription ends, is refunded or
 * changes tier. Allowances belong to the subscription, not the account.
 */
export function revokeAllowanceStatements(
  db: D1Database,
  userId: string,
  reason: string,
  now: number,
  kinds: BucketKind[] = ['sub_daily', 'vip_weekly'],
): D1PreparedStatement[] {
  const inKinds = `(${kinds.map((k) => `'${k}'`).join(', ')})`;
  const where = `user_id = ?1 AND kind IN ${inKinds} AND balance > 0 AND expires_at > ?2`;
  return [
    db
      .prepare(
        `INSERT INTO credit_ledger (id, user_id, bucket_kind, delta, reason, ref, actor, created_at)
         SELECT lower(hex(randomblob(16))), user_id, kind, -balance, ?3, period_key, NULL, ?2 FROM credit_bucket WHERE ${where}`,
      )
      .bind(userId, now, reason),
    db.prepare(`UPDATE credit_bucket SET balance = 0 WHERE ${where}`).bind(userId, now),
  ];
}

/**
 * A subscription moved to another account (RevenueCat TRANSFER, e.g. "Restore purchases"
 * while signed in as someone else). The current period's allowance moves with it, so the
 * same period can never be granted twice by transferring back and forth.
 */
export function moveAllowanceStatements(db: D1Database, fromUser: string, toUser: string, now: number): D1PreparedStatement[] {
  const live = `user_id = ?1 AND kind IN ${ALLOWANCE_KINDS} AND expires_at > ?3`;
  const free = `NOT EXISTS (SELECT 1 FROM credit_bucket b WHERE b.user_id = ?2 AND b.kind = credit_bucket.kind AND b.period_key = credit_bucket.period_key)`;
  return [
    db
      .prepare(
        `INSERT INTO credit_ledger (id, user_id, bucket_kind, delta, reason, ref, actor, created_at)
         SELECT lower(hex(randomblob(16))), ?2, kind, balance, 'transfer_in', period_key, NULL, ?3 FROM credit_bucket
         WHERE ${live} AND balance > 0 AND ${free}`,
      )
      .bind(fromUser, toUser, now),
    db
      .prepare(
        `INSERT INTO credit_ledger (id, user_id, bucket_kind, delta, reason, ref, actor, created_at)
         SELECT lower(hex(randomblob(16))), user_id, kind, -balance, 'transfer_out', period_key, NULL, ?3 FROM credit_bucket
         WHERE ${live} AND balance > 0`,
      )
      .bind(fromUser, toUser, now),
    db.prepare(`UPDATE credit_bucket SET user_id = ?2 WHERE ${live} AND ${free}`).bind(fromUser, toUser, now),
    // Periods the receiving account already had: the sender's copy is simply removed.
    db.prepare(`UPDATE credit_bucket SET balance = 0 WHERE ${live}`).bind(fromUser, toUser, now),
  ];
}

/* ------------------------------------------------------------------ session passes */

/** Starts the user's oldest unused 3-hour pass. Only one pass can run at a time. */
export async function activatePass(db: D1Database, userId: string, now = Date.now()) {
  const active = await db
    .prepare(`SELECT id, expires_at FROM session_pass WHERE user_id = ? AND status = 'active' AND expires_at > ?`)
    .bind(userId, now)
    .first<{ id: string; expires_at: number }>();
  if (active) throw new ApiError(409, 'bad_request', 'A session pass is already running.');

  const pass = await db
    .prepare(`SELECT id FROM session_pass WHERE user_id = ? AND status = 'available' ORDER BY created_at LIMIT 1`)
    .bind(userId)
    .first<{ id: string }>();
  if (!pass) throw new ApiError(404, 'not_found', 'You have no unused session passes.');

  const product = PRODUCTS.pass_3h;
  if (product.kind !== 'pass') throw new Error('pass_3h must be a pass product');
  const expiresAt = now + product.durationMinutes * 60_000;
  // Each statement only runs if the previous one changed a row, so a concurrent activation
  // can neither start a second pass nor write a second credit grant.
  const results = await db.batch([
    db
      .prepare(
        `UPDATE session_pass SET status = 'active', activated_at = ?1, expires_at = ?2
         WHERE id = ?3 AND status = 'available'
           AND NOT EXISTS (SELECT 1 FROM session_pass WHERE user_id = ?4 AND status = 'active' AND expires_at > ?1)`,
      )
      .bind(now, expiresAt, pass.id, userId),
    db
      .prepare(
        `INSERT INTO credit_bucket (id, user_id, kind, balance, expires_at, period_key, created_at)
         SELECT ?, ?, 'pass', ?, ?, ?, ? WHERE changes() = 1`,
      )
      .bind(crypto.randomUUID(), userId, product.credits, expiresAt, pass.id, now),
    db
      .prepare(
        `INSERT INTO credit_ledger (id, user_id, bucket_kind, delta, reason, ref, actor, created_at)
         SELECT ?, ?, 'pass', ?, 'pass_activated', ?, NULL, ? WHERE changes() = 1`,
      )
      .bind(crypto.randomUUID(), userId, product.credits, pass.id, now),
  ]);
  if (results[0]!.meta.changes !== 1) throw new ApiError(409, 'bad_request', 'A session pass is already running.');
  return { passId: pass.id, expiresAt };
}

/* ------------------------------------------------------------------ entitlements */

export async function getTier(db: D1Database, userId: string, now = Date.now()): Promise<Tier> {
  const sub = await getActiveSubscription(db, userId, now);
  if (sub) return sub.tier;
  const row = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM session_pass WHERE user_id = ?1 AND status = 'active' AND expires_at > ?2) AS has_pass,
         EXISTS (SELECT 1 FROM purchase WHERE user_id = ?1 AND kind IN ('credits', 'pass') AND refunded_at IS NULL) AS has_purchase`,
    )
    .bind(userId, now)
    .first<{ has_pass: number; has_purchase: number }>();
  if (row?.has_pass) return 'pass';
  if (row?.has_purchase) return 'credits';
  return 'free';
}

export async function getEntitlements(db: D1Database, userId: string, now = Date.now()): Promise<Entitlements> {
  await ensureAllowanceBuckets(db, userId, now);
  const [tier, sub, buckets, pass, available] = await Promise.all([
    getTier(db, userId, now),
    getActiveSubscription(db, userId, now),
    spendableBuckets(db, userId, now),
    db
      .prepare(`SELECT expires_at FROM session_pass WHERE user_id = ? AND status = 'active' AND expires_at > ?`)
      .bind(userId, now)
      .first<{ expires_at: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM session_pass WHERE user_id = ? AND status = 'available'`)
      .bind(userId)
      .first<{ n: number }>(),
  ]);
  return {
    tier,
    balance: buckets.reduce((sum, b) => sum + b.balance, 0),
    buckets: buckets.map((b) => ({
      kind: b.kind,
      balance: b.balance,
      expiresAt: b.expires_at ? new Date(b.expires_at).toISOString() : null,
    })),
    subscription: sub
      ? { productId: sub.product_id, expiresAt: new Date(sub.expires_at).toISOString(), willRenew: sub.will_renew === 1 }
      : null,
    pass: pass ? { expiresAt: new Date(pass.expires_at).toISOString() } : null,
    passesAvailable: available?.n ?? 0,
    rateLimitPerMinute: RATE_LIMITS_PER_MINUTE[tier],
  };
}

/* ------------------------------------------------------------------ helpers */

export function ledger(
  db: D1Database,
  userId: string,
  kind: BucketKind,
  delta: number,
  reason: string,
  ref: string | null,
  actor: string | null = null,
  now = Date.now(),
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO credit_ledger (id, user_id, bucket_kind, delta, reason, ref, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), userId, kind, delta, reason, ref, actor, now);
}

function isCheckViolation(err: unknown): boolean {
  return err instanceof Error && /CHECK constraint failed/i.test(err.message);
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
