/**
 * Monetisation model shared by the app, the API and the admin portal.
 *
 * Every cloud action costs credits. Credits live in "buckets" on the server, and a
 * charge is taken from the bucket that expires soonest, so time-limited allowances
 * are always used before credits the user bought outright:
 *
 *   pass       3-hour session pass allowance (expires with the pass)
 *   sub_daily  subscription fair-use allowance (resets every day)
 *   vip_weekly VIP allowance (resets every week, unused credits do not roll over)
 *   grant      free credits given by us (welcome gift, support goodwill)
 *   purchased  credit packs (never expire)
 *
 * Offline features (on-device translation, speech, camera OCR, dictionary) never
 * touch the server and are free for everyone, signed in or not.
 */

export const BUCKET_KINDS = ['pass', 'sub_daily', 'vip_weekly', 'grant', 'purchased'] as const;
export type BucketKind = (typeof BUCKET_KINDS)[number];

/** Order in which buckets are spent when expiry dates are equal (or both never expire). */
export const BUCKET_SPEND_ORDER: Record<BucketKind, number> = {
  pass: 0,
  sub_daily: 1,
  vip_weekly: 2,
  grant: 3,
  purchased: 4,
};

export type Tier = 'free' | 'credits' | 'pass' | 'pro' | 'vip';

export const PRODUCT_IDS = [
  'pro_weekly',
  'pro_monthly',
  'pro_yearly',
  'vip_monthly',
  'vip_yearly',
  'credits_100',
  'credits_500',
  'credits_2000',
  'pass_3h',
] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];

export type Product =
  | { id: ProductId; kind: 'subscription'; tier: 'pro' | 'vip'; period: 'week' | 'month' | 'year' }
  | { id: ProductId; kind: 'credits'; credits: number }
  | { id: ProductId; kind: 'pass'; durationMinutes: number; credits: number };

/**
 * Store products. The IDs must match App Store Connect / Google Play / RevenueCat exactly.
 * Prices are set in the stores, never here.
 */
export const PRODUCTS: Record<ProductId, Product> = {
  pro_weekly: { id: 'pro_weekly', kind: 'subscription', tier: 'pro', period: 'week' },
  pro_monthly: { id: 'pro_monthly', kind: 'subscription', tier: 'pro', period: 'month' },
  pro_yearly: { id: 'pro_yearly', kind: 'subscription', tier: 'pro', period: 'year' },
  vip_monthly: { id: 'vip_monthly', kind: 'subscription', tier: 'vip', period: 'month' },
  vip_yearly: { id: 'vip_yearly', kind: 'subscription', tier: 'vip', period: 'year' },
  credits_100: { id: 'credits_100', kind: 'credits', credits: 100 },
  credits_500: { id: 'credits_500', kind: 'credits', credits: 500 },
  credits_2000: { id: 'credits_2000', kind: 'credits', credits: 2000 },
  pass_3h: { id: 'pass_3h', kind: 'pass', durationMinutes: 180, credits: 150 },
};

/** RevenueCat entitlement identifiers (configure the same names in the RevenueCat dashboard). */
export const ENTITLEMENTS = { pro: 'pro', vip: 'vip' } as const;

export const ALLOWANCES = {
  /** Pro subscribers: credits per day (≈ 100,000 characters of cloud translation). */
  proDailyCredits: 200,
  /** VIP subscribers: credits per week, reset every Monday 00:00 UTC. */
  vipWeeklyCredits: 3000,
  /** One-time gift when a user creates an account. */
  welcomeCredits: 20,
} as const;

/** What each cloud action costs. One credit ≈ 500 characters. */
export const CHARS_PER_CREDIT = 500;

export const COSTS = {
  translateText: (chars: number) => Math.max(1, Math.ceil(chars / CHARS_PER_CREDIT)),
  ocrImage: () => 2,
  translateDocument: (chars: number) => Math.max(5, Math.ceil(chars / CHARS_PER_CREDIT)),
} as const;

/** Hard limits per request, enforced by the API whatever the user's plan. */
export const REQUEST_LIMITS = {
  maxTextChars: 5000,
  maxImageBytes: 4 * 1024 * 1024,
  maxDocumentBytes: 10 * 1024 * 1024,
  maxDocumentChars: { free: 20_000, credits: 100_000, pass: 100_000, pro: 300_000, vip: 500_000 } satisfies Record<Tier, number>,
} as const;

/** Requests per minute per user. Matches the rate-limit bindings in apps/api/wrangler.jsonc. */
export const RATE_LIMITS_PER_MINUTE: Record<Tier, number> = {
  free: 10,
  credits: 30,
  pass: 30,
  pro: 60,
  vip: 90,
};

/** Session rules chosen by the product owner. */
export const SESSION_RULES = {
  /** Signed out after this many days without opening the app. */
  inactivityDays: 30,
  /** Signed out after this many days no matter what. */
  absoluteDays: 60,
  /** Sensitive actions (delete account, change email) need a sign-in this recent. */
  freshMinutes: 10,
} as const;

/** Start of the current VIP week (Monday 00:00 UTC) for a given time. */
export function startOfWeekUtc(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

/** Start of the current day (00:00 UTC). */
export function startOfDayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function isProductId(value: string): value is ProductId {
  return (PRODUCT_IDS as readonly string[]).includes(value);
}
