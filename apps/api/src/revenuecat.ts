import { ENTITLEMENTS, PRODUCTS, isProductId, type ProductId } from '@translator/shared';
import { addCreditsStatements, moveAllowanceStatements, revokeAllowanceStatements } from './credits';
import type { Env } from './env';

/**
 * Store purchases arrive from RevenueCat as webhooks. The app's RevenueCat user id is our
 * user id, set with Purchases.logIn(user.id) after sign-in.
 *
 * Consumables (credit packs, session passes) are granted once per store transaction id.
 * Subscription state is re-read from RevenueCat's API after every event (their advice),
 * so out-of-order or missed webhooks can't leave a user with the wrong plan.
 */

export interface RevenueCatEvent {
  id: string;
  type: string;
  app_user_id: string;
  original_app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  new_product_id?: string;
  entitlement_ids?: string[] | null;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  transaction_id?: string;
  original_transaction_id?: string;
  store?: string;
  environment?: 'SANDBOX' | 'PRODUCTION';
  price?: number;
  cancel_reason?: string;
  transferred_from?: string[];
  transferred_to?: string[];
}

export type Outcome = 'processed' | 'ignored';

const SUBSCRIPTION_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'CANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
  'SUBSCRIPTION_EXTENDED',
  'SUBSCRIPTION_PAUSED',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'REFUND_REVERSED',
]);

export async function handleEvent(env: Env, event: RevenueCatEvent, now = Date.now()): Promise<Outcome> {
  if (event.type === 'TEST') return 'ignored';

  if (event.type === 'TRANSFER') {
    const from = await existingUsers(env.DB, event.transferred_from ?? []);
    const to = await existingUsers(env.DB, event.transferred_to ?? []);
    for (const id of from) {
      await env.DB.batch(to[0] ? moveAllowanceStatements(env.DB, id, to[0], now) : revokeAllowanceStatements(env.DB, id, 'transfer_out', now));
      await syncSubscription(env, id, null, now, { lostAccess: true });
    }
    for (const id of to) await syncSubscription(env, id, null, now);
    return 'processed';
  }

  const userId = await resolveUser(env.DB, event);
  if (!userId) return 'ignored';
  // Test purchases (TestFlight, Play license testers) only count for allow-listed testers.
  if (event.environment === 'SANDBOX' && !sandboxAllowed(env, userId)) return 'ignored';
  const productId = normaliseProduct(event.product_id);
  const product = productId ? PRODUCTS[productId] : null;

  if (event.type === 'NON_RENEWING_PURCHASE') {
    if (!product || product.kind === 'subscription' || !event.transaction_id) return 'ignored';
    await grantConsumable(env.DB, userId, productId!, event, now);
    return 'processed';
  }

  if (event.type === 'CANCELLATION' && product && product.kind !== 'subscription') {
    // Refund of a consumable (RevenueCat reports refunds as CUSTOMER_SUPPORT cancellations).
    if (event.cancel_reason === 'CUSTOMER_SUPPORT' && event.transaction_id) {
      await revokeConsumable(env.DB, userId, productId!, event.transaction_id, now);
      return 'processed';
    }
    return 'ignored';
  }

  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    if ((event.type === 'INITIAL_PURCHASE' || event.type === 'RENEWAL') && product?.kind === 'subscription' && event.transaction_id) {
      await recordPurchase(env.DB, userId, productId!, 'subscription', event, now).catch(ignoreDuplicate);
    }
    if (event.type === 'CANCELLATION' && event.cancel_reason === 'CUSTOMER_SUPPORT' && event.transaction_id) {
      await env.DB.prepare('UPDATE purchase SET refunded_at = ? WHERE transaction_id = ? AND refunded_at IS NULL').bind(now, event.transaction_id).run();
    }
    await syncSubscription(env, userId, event, now);
    return 'processed';
  }

  return 'ignored';
}

/* ------------------------------------------------------------------ consumables */

async function grantConsumable(db: D1Database, userId: string, productId: ProductId, e: RevenueCatEvent, now: number) {
  const product = PRODUCTS[productId];
  const purchaseId = crypto.randomUUID();
  const statements = [purchaseStatement(db, purchaseId, userId, productId, product.kind, e, now)];
  if (product.kind === 'credits') {
    statements.push(...addCreditsStatements(db, userId, 'purchased', product.credits, 'purchase', e.transaction_id!, null, now));
  } else if (product.kind === 'pass') {
    statements.push(
      db
        .prepare(`INSERT INTO session_pass (id, user_id, purchase_id, status, created_at) VALUES (?, ?, ?, 'available', ?)`)
        .bind(crypto.randomUUID(), userId, purchaseId, now),
    );
  }
  // The purchase insert fails on a repeated transaction id, which rolls back the grant too.
  await db.batch(statements).catch(ignoreDuplicate);
}

/**
 * Refund of a credit pack or pass. One atomic batch: each step only runs if the previous
 * one changed a row, so a retried or duplicated webhook can never claw back twice, and a
 * failure leaves nothing half-done. Credits already spent can't be taken back.
 */
async function revokeConsumable(db: D1Database, userId: string, productId: ProductId, transactionId: string, now: number) {
  const product = PRODUCTS[productId];
  const markRefunded = db
    .prepare('UPDATE purchase SET refunded_at = ? WHERE transaction_id = ? AND refunded_at IS NULL')
    .bind(now, transactionId);

  if (product.kind === 'credits') {
    const bucket = `user_id = ?1 AND kind = 'purchased' AND period_key = 'main'`;
    await db.batch([
      markRefunded,
      db
        .prepare(
          `INSERT INTO credit_ledger (id, user_id, bucket_kind, delta, reason, ref, actor, created_at)
           SELECT lower(hex(randomblob(16))), user_id, 'purchased', -MIN(balance, ?2), 'refund_clawback', ?3, NULL, ?4
           FROM credit_bucket WHERE ${bucket} AND balance > 0 AND changes() = 1`,
        )
        .bind(userId, product.credits, transactionId, now),
      db.prepare(`UPDATE credit_bucket SET balance = balance - MIN(balance, ?2) WHERE ${bucket} AND changes() = 1`).bind(userId, product.credits),
    ]);
  } else if (product.kind === 'pass') {
    const passId = `(SELECT sp.id FROM session_pass sp JOIN purchase p ON p.id = sp.purchase_id WHERE p.transaction_id = ?3)`;
    await db.batch([
      markRefunded,
      db
        .prepare(`UPDATE session_pass SET status = 'refunded', expires_at = MIN(COALESCE(expires_at, ?2), ?2) WHERE id = ${passId} AND changes() = 1`)
        .bind(userId, now, transactionId),
      db
        .prepare(
          `INSERT INTO credit_ledger (id, user_id, bucket_kind, delta, reason, ref, actor, created_at)
           SELECT lower(hex(randomblob(16))), user_id, 'pass', -balance, 'refund_clawback', ?3, NULL, ?2
           FROM credit_bucket WHERE user_id = ?1 AND kind = 'pass' AND period_key = ${passId} AND balance > 0 AND changes() = 1`,
        )
        .bind(userId, now, transactionId),
      db
        .prepare(`UPDATE credit_bucket SET balance = 0, expires_at = ?2 WHERE user_id = ?1 AND kind = 'pass' AND period_key = ${passId} AND changes() = 1`)
        .bind(userId, now, transactionId),
    ]);
  }
}

function purchaseStatement(
  db: D1Database,
  id: string,
  userId: string,
  productId: ProductId,
  kind: 'subscription' | 'credits' | 'pass',
  e: RevenueCatEvent,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO purchase (id, user_id, product_id, kind, store, transaction_id, environment, price_usd, purchased_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, productId, kind, e.store ?? null, e.transaction_id!, e.environment ?? null, e.price ?? null, e.purchased_at_ms ?? now);
}

function recordPurchase(db: D1Database, userId: string, productId: ProductId, kind: 'subscription', e: RevenueCatEvent, now: number) {
  return purchaseStatement(db, crypto.randomUUID(), userId, productId, kind, e, now).run();
}

function ignoreDuplicate(err: unknown): void {
  if (err instanceof Error && /UNIQUE constraint failed: purchase\.transaction_id/i.test(err.message)) return;
  throw err;
}

/* ------------------------------------------------------------------ subscriptions */

interface RcEntitlement {
  expires_date: string | null;
  grace_period_expires_date?: string | null;
  product_identifier: string;
}
interface RcSubscription {
  unsubscribe_detected_at?: string | null;
  billing_issues_detected_at?: string | null;
  store?: string;
  is_sandbox?: boolean;
}

/**
 * Writes the user's current Pro/VIP state. In production this always re-reads RevenueCat's
 * API (the event body is only trusted in local development), and any allowance the user is
 * no longer entitled to is removed.
 */
export async function syncSubscription(
  env: Env,
  userId: string,
  event: RevenueCatEvent | null,
  now = Date.now(),
  opts: { lostAccess?: boolean } = {},
) {
  const key = env.REVENUECAT_SECRET_KEY;
  if (!key && env.ENVIRONMENT !== 'development') throw new Error('REVENUECAT_SECRET_KEY is not configured');
  const previous = await env.DB.prepare('SELECT tier FROM subscription WHERE user_id = ?').bind(userId).first<{ tier: 'pro' | 'vip' }>();
  const state = key ? await stateFromApi(key, userId, now, sandboxAllowed(env, userId)) : opts.lostAccess ? null : stateFromEvent(event);

  // Without an API key (local development only) and without an event, nothing is known.
  if (!state && !key && !opts.lostAccess) return;
  if (!state || state.status === 'expired') {
    // No entitlement any more (expired, refunded or moved to another account): end access now.
    await env.DB.batch([
      env.DB
        .prepare(`UPDATE subscription SET status = 'expired', will_renew = 0, expires_at = MIN(expires_at, ?), updated_at = ? WHERE user_id = ?`)
        .bind(now, now, userId),
      ...revokeAllowanceStatements(env.DB, userId, 'subscription_ended', now),
    ]);
    if (!state) return;
  }

  const statements = [
    env.DB.prepare(
      `INSERT INTO subscription (user_id, tier, product_id, store, status, will_renew, expires_at, original_transaction_id, environment, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         tier = excluded.tier, product_id = excluded.product_id, store = excluded.store, status = excluded.status,
         will_renew = excluded.will_renew, expires_at = excluded.expires_at,
         original_transaction_id = COALESCE(excluded.original_transaction_id, original_transaction_id),
         environment = excluded.environment, updated_at = excluded.updated_at`,
    ).bind(
      userId,
      state.tier,
      state.productId,
      state.store,
      state.status,
      state.willRenew ? 1 : 0,
      state.expiresAt,
      event?.original_transaction_id ?? null,
      state.environment,
      now,
    ),
  ];
  // Switching between Pro and VIP removes the old plan's remaining allowance.
  if (previous && previous.tier !== state.tier) {
    statements.push(...revokeAllowanceStatements(env.DB, userId, 'plan_changed', now, [previous.tier === 'vip' ? 'vip_weekly' : 'sub_daily']));
  }
  await env.DB.batch(statements);
}

export function sandboxAllowed(env: Env, userId: string): boolean {
  if (env.ENVIRONMENT === 'development') return true;
  return (env.SANDBOX_USER_IDS ?? '').split(',').map((s) => s.trim()).includes(userId);
}

interface SubState {
  tier: 'pro' | 'vip';
  productId: string;
  store: string | null;
  status: 'active' | 'cancelled' | 'billing_issue' | 'expired';
  willRenew: boolean;
  expiresAt: number;
  environment: string | null;
}

async function stateFromApi(secretKey: string, userId: string, now: number, allowSandbox: boolean): Promise<SubState | null> {
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) throw new Error(`RevenueCat subscriber lookup failed with ${res.status}`);
  const { subscriber } = await res.json<{
    subscriber: { entitlements: Record<string, RcEntitlement>; subscriptions: Record<string, RcSubscription> };
  }>();

  const pick = (id: string) => {
    const e = subscriber.entitlements[id];
    if (!e) return null;
    if (subscriber.subscriptions[e.product_identifier]?.is_sandbox && !allowSandbox) return null;
    const until = Math.max(Date.parse(e.expires_date ?? '9999-12-31'), Date.parse(e.grace_period_expires_date ?? '0') || 0);
    return { e, until };
  };
  // VIP first so it wins when both are active; otherwise the most recent one.
  const found = [
    { tier: 'vip' as const, hit: pick(ENTITLEMENTS.vip) },
    { tier: 'pro' as const, hit: pick(ENTITLEMENTS.pro) },
  ].flatMap(({ tier, hit }) => (hit ? [{ tier, ...hit }] : []));
  const active = found.find((x) => x.until > now);
  const chosen = active ?? [...found].sort((a, b) => b.until - a.until)[0];
  if (!chosen) return null;

  const sub = subscriber.subscriptions[chosen.e.product_identifier] ?? {};
  const status: SubState['status'] = !active
    ? 'expired'
    : sub.billing_issues_detected_at
      ? 'billing_issue'
      : sub.unsubscribe_detected_at
        ? 'cancelled'
        : 'active';
  return {
    tier: chosen.tier,
    productId: normaliseProduct(chosen.e.product_identifier) ?? chosen.e.product_identifier,
    store: sub.store ?? null,
    status,
    willRenew: status === 'active' || status === 'billing_issue',
    expiresAt: chosen.until,
    environment: sub.is_sandbox ? 'SANDBOX' : 'PRODUCTION',
  };
}

function stateFromEvent(e: RevenueCatEvent | null): SubState | null {
  if (!e) return null;
  const productId = normaliseProduct(e.new_product_id ?? e.product_id);
  const product = productId ? PRODUCTS[productId] : null;
  const ids = e.entitlement_ids ?? [];
  const tier = ids.includes(ENTITLEMENTS.vip) ? 'vip' : ids.includes(ENTITLEMENTS.pro) ? 'pro' : product?.kind === 'subscription' ? product.tier : null;
  if (!tier || !e.expiration_at_ms) return null;
  const status: SubState['status'] =
    e.type === 'EXPIRATION' ? 'expired' : e.type === 'BILLING_ISSUE' ? 'billing_issue' : e.type === 'CANCELLATION' ? 'cancelled' : 'active';
  return {
    tier,
    productId: productId ?? e.product_id ?? 'unknown',
    store: e.store ?? null,
    status,
    willRenew: status === 'active',
    expiresAt: e.expiration_at_ms,
    environment: e.environment ?? null,
  };
}

/* ------------------------------------------------------------------ helpers */

/** Google Play reports subscriptions as "product:base-plan". */
export function normaliseProduct(id: string | undefined): ProductId | null {
  if (!id) return null;
  const base = id.split(':')[0]!;
  return isProductId(base) ? base : null;
}

async function resolveUser(db: D1Database, e: RevenueCatEvent): Promise<string | null> {
  const candidates = [e.app_user_id, e.original_app_user_id, ...(e.aliases ?? [])].filter(
    (id): id is string => !!id && !id.startsWith('$RCAnonymousID:'),
  );
  for (const id of new Set(candidates)) if (await userExists(db, id)) return id;
  return null;
}

async function existingUsers(db: D1Database, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of new Set(ids)) if (!id.startsWith('$RCAnonymousID:') && (await userExists(db, id))) out.push(id);
  return out;
}

async function userExists(db: D1Database, id: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 FROM "user" WHERE id = ?').bind(id).first());
}

/** Removes the customer from RevenueCat when the user deletes their account. */
export async function deleteRevenueCatCustomer(env: Env, userId: string): Promise<void> {
  if (!env.REVENUECAT_SECRET_KEY) return;
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${env.REVENUECAT_SECRET_KEY}` },
  });
  if (!res.ok && res.status !== 404) console.error(`RevenueCat customer delete failed with ${res.status}`);
}
