import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Tier } from '@translator/shared';
import { SESSION_ABSOLUTE_MS, auth } from './auth';
import { getTier } from './credits';
import type { AppEnv, Env } from './env';
import { ApiError } from './errors';

/** Requires a signed-in, non-banned user whose session is younger than 60 days. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  // Always read the session from the database (not the 5-minute cookie cache) so bans,
  // sign-out-everywhere and password resets take effect on the very next request.
  const session = await auth.api.getSession({ headers: c.req.raw.headers, query: { disableCookieCache: true } });
  if (!session) throw new ApiError(401, 'unauthorized', 'Please sign in.');

  // Backstop for the absolute session lifetime (the cookie cache can skip the DB hook).
  if (Date.now() - new Date(session.session.createdAt).getTime() > SESSION_ABSOLUTE_MS) {
    await auth.api.revokeSession({ headers: c.req.raw.headers, body: { token: session.session.token } }).catch(() => {});
    throw new ApiError(401, 'unauthorized', 'Your session has expired. Please sign in again.');
  }
  const u = session.user as typeof session.user & { banned?: boolean | null; role?: string | null };
  if (u.banned) throw new ApiError(403, 'forbidden', 'This account has been suspended.');

  c.set('user', { id: u.id, email: u.email, role: u.role ?? null });
  await next();
});

/* ------------------------------------------------------------------ rate limiting */

const tierCache = new Map<string, { tier: Tier; at: number }>();
const TIER_CACHE_MS = 60_000;

async function cachedTier(db: D1Database, userId: string): Promise<Tier> {
  const now = Date.now();
  const hit = tierCache.get(userId);
  if (hit && now - hit.at < TIER_CACHE_MS) return hit.tier;
  const tier = await getTier(db, userId, now);
  if (tierCache.size > 10_000) tierCache.clear();
  tierCache.set(userId, { tier, at: now });
  return tier;
}

export function forgetTier(userId: string): void {
  tierCache.delete(userId);
}

function limiterFor(env: Env, tier: Tier): RateLimit {
  switch (tier) {
    case 'vip':
      return env.LIMIT_VIP;
    case 'pro':
      return env.LIMIT_PRO;
    case 'pass':
    case 'credits':
      return env.LIMIT_PAID;
    default:
      return env.LIMIT_FREE;
  }
}

/** Per-user request limit that scales with the user's plan. Use after requireUser. */
export const userRateLimit = createMiddleware<AppEnv>(async (c, next) => {
  const { id } = c.get('user');
  const tier = await cachedTier(c.env.DB, id);
  const { success } = await limiterFor(c.env, tier).limit({ key: id });
  if (!success) {
    c.header('retry-after', '60');
    throw new ApiError(429, 'rate_limited', 'Too many requests. Please wait a minute and try again.');
  }
  await next();
});

/** Per-IP limit for public endpoints (sign-in, webhooks), on top of Better Auth's own. */
export const ipRateLimit = createMiddleware<AppEnv>(async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const { success } = await c.env.LIMIT_PUBLIC.limit({ key: ip });
  if (!success) {
    c.header('retry-after', '60');
    throw new ApiError(429, 'rate_limited', 'Too many requests. Please wait a minute and try again.');
  }
  await next();
});

/* ------------------------------------------------------------------ admin */

let jwks: { domain: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;

/**
 * Admin routes sit behind Cloudflare Access (SSO + MFA). We verify the signed Access
 * token on every request instead of trusting that traffic came through Access.
 */
export const requireAdmin = createMiddleware<AppEnv & { Variables: { adminEmail: string } }>(async (c, next) => {
  const { ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: aud, ENVIRONMENT, ADMIN_DEV_BYPASS } = c.env;
  if (!domain || !aud) {
    // Local development only: needs ENVIRONMENT=development, ADMIN_DEV_BYPASS=1 (set in
    // .dev.vars, never as a deployed secret) and a request to localhost.
    const host = new URL(c.req.url).hostname;
    const local = host === 'localhost' || host === '127.0.0.1';
    if (ENVIRONMENT === 'development' && ADMIN_DEV_BYPASS === '1' && local) {
      c.set('adminEmail', 'dev-admin@localhost');
      return next();
    }
    throw new ApiError(403, 'forbidden', 'Admin access is not configured.');
  }
  const token = c.req.header('cf-access-jwt-assertion');
  if (!token) throw new ApiError(403, 'forbidden', 'Admin access required.');
  const issuer = `https://${domain.replace(/^https?:\/\//, '')}`;
  if (!jwks || jwks.domain !== issuer) {
    jwks = { domain: issuer, set: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)) };
  }
  try {
    const { payload } = await jwtVerify(token, jwks.set, { issuer, audience: aud });
    if (typeof payload.email !== 'string') throw new Error('no email');
    c.set('adminEmail', payload.email);
  } catch {
    throw new ApiError(403, 'forbidden', 'Admin access required.');
  }
  await next();
});

/* ------------------------------------------------------------------ headers */

/** Request id for log correlation and safe defaults on every response. */
export const baseHeaders = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  await next();
  c.header('x-request-id', requestId);
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'no-referrer');
  c.header('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');
  c.header('cross-origin-resource-policy', 'same-site');
  if (!c.res.headers.has('cache-control')) c.header('cache-control', 'no-store');
});
