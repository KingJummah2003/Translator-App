import { env, waitUntil } from 'cloudflare:workers';
import { betterAuth } from 'better-auth';
import { admin, emailOTP } from 'better-auth/plugins';
import { expo } from '@better-auth/expo';
import { ALLOWANCES, SESSION_RULES } from '@translator/shared';
import { sendEmail } from './email';
import { deleteRevenueCatCustomer } from './revenuecat';
import type { Env } from './env';

const DAY_S = 86_400;
const ABSOLUTE_MS = SESSION_RULES.absoluteDays * DAY_S * 1000;
const bindings = env as unknown as Env;
// Only an explicit 'development' value relaxes anything; a missing or mistyped value is treated as production.
const isDev = bindings.ENVIRONMENT === 'development';

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Accounts and sessions.
 *
 * - Sign in with Apple, Google, a one-time email code, or email + password.
 * - Sessions slide: each day the app is used extends them to 30 days from now, but they
 *   end 60 days after sign-in no matter what (see the session hook below and
 *   `requireUser` in middleware.ts, which double-checks it).
 * - Brute-force protection on every sign-in route, stored in D1 so it holds across all
 *   Cloudflare locations.
 */
export const auth = betterAuth({
  appName: 'Translator',
  baseURL: bindings.API_URL,
  secret: bindings.BETTER_AUTH_SECRET,
  database: bindings.DB,
  telemetry: { enabled: false },

  trustedOrigins: [
    `${bindings.APP_SCHEME}://`,
    'https://appleid.apple.com',
    ...list(bindings.ADMIN_ORIGINS),
    ...(isDev ? ['exp://', 'exp://**'] : []),
  ],

  session: {
    expiresIn: SESSION_RULES.inactivityDays * DAY_S,
    updateAge: DAY_S,
    freshAge: SESSION_RULES.freshMinutes * 60,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
  },

  socialProviders: {
    ...(bindings.APPLE_CLIENT_ID && {
      apple: {
        // Native sign-in only: the app sends Apple's ID token and we verify it.
        clientId: bindings.APPLE_CLIENT_ID,
        clientSecret: '',
        appBundleIdentifier: bindings.APPLE_APP_BUNDLE_ID,
      },
    }),
    ...(bindings.GOOGLE_OAUTH_CLIENT_IDS && {
      google: {
        // Web, iOS and Android client IDs; ID tokens from any of them are accepted.
        clientId: list(bindings.GOOGLE_OAUTH_CLIENT_IDS),
        clientSecret: '',
      },
    }),
  },

  account: {
    accountLinking: { enabled: true, trustedProviders: ['apple', 'google'] },
  },

  user: {
    deleteUser: {
      enabled: true,
      // Database rows go with the user (ON DELETE CASCADE); purchases are kept unlinked for accounting.
      afterDelete: async (user) => {
        waitUntil(deleteRevenueCatCustomer(bindings, user.id));
      },
    },
  },

  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 60,
    customRules: {
      '/sign-in/email': { window: 300, max: 5 },
      '/sign-up/email': { window: 3600, max: 5 },
      '/sign-in/email-otp': { window: 300, max: 5 },
      '/email-otp/send-verification-otp': { window: 300, max: 3 },
      '/email-otp/reset-password': { window: 300, max: 5 },
      '/forget-password/email-otp': { window: 300, max: 3 },
      '/email-otp/request-password-reset': { window: 300, max: 3 },
      '/email-otp/verify-email': { window: 300, max: 5 },
      '/email-otp/check-verification-otp': { window: 300, max: 5 },
      '/sign-in/social': { window: 60, max: 10 },
      '/delete-user': { window: 3600, max: 3 },
    },
  },

  plugins: [
    expo(),
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      allowedAttempts: 5,
      storeOTP: 'hashed',
      sendVerificationOnSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        const subject =
          type === 'forget-password' ? 'Reset your Translator password' : `${otp} is your Translator code`;
        // Don't make the request wait for the email provider.
        waitUntil(sendEmail(bindings, { to: email, subject, text: otpEmail(otp, type) }));
      },
    }),
    // Adds ban fields and blocks banned users at sign-in. Admin actions themselves go
    // through /admin routes protected by Cloudflare Access.
    admin({ bannedUserMessage: 'This account has been suspended. Contact support if you think this is a mistake.' }),
  ],

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          if (ALLOWANCES.welcomeCredits <= 0) return;
          // Once per email address ever, so deleting and recreating an account (or using
          // name+tag@ variants) doesn't mint new free credits. Each step only runs if the
          // previous one inserted a row.
          const now = Date.now();
          const db = bindings.DB;
          await db.batch([
            db.prepare('INSERT INTO welcome_grant (email_hash, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(await emailHash(user.email), now),
            db
              .prepare(
                `INSERT INTO credit_bucket (id, user_id, kind, balance, expires_at, period_key, created_at)
                 SELECT ?, ?, 'grant', ?, NULL, 'main', ? WHERE changes() = 1`,
              )
              .bind(crypto.randomUUID(), user.id, ALLOWANCES.welcomeCredits, now),
            db
              .prepare(
                `INSERT INTO credit_ledger (id, user_id, bucket_kind, delta, reason, ref, actor, created_at)
                 SELECT ?, ?, 'grant', ?, 'welcome', NULL, NULL, ? WHERE changes() = 1`,
              )
              .bind(crypto.randomUUID(), user.id, ALLOWANCES.welcomeCredits, now),
          ]);
        },
      },
    },
    session: {
      update: {
        // Sliding refresh must never push a session past 60 days from sign-in.
        before: async (data, ctx) => {
          const createdAt = ctx?.context.session?.session.createdAt;
          if (data.expiresAt && createdAt) {
            const cap = new Date(new Date(createdAt).getTime() + ABSOLUTE_MS);
            if (new Date(data.expiresAt) > cap) return { data: { ...data, expiresAt: cap } };
          }
          return { data };
        },
      },
    },
  },

  advanced: {
    // The schema is owned by migrations/ (and covered by tests). Skipping the runtime
    // check saves a round of introspection queries on every cold start.
    database: { validateSchema: false },
    ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    backgroundTasks: { handler: waitUntil },
    useSecureCookies: !isDev,
  },
});

export type Session = typeof auth.$Infer.Session;

export const SESSION_ABSOLUTE_MS = ABSOLUTE_MS;

/** Keyed hash of a normalised email address (lowercase, no +tag, Gmail dots ignored). */
export async function emailHash(email: string): Promise<string> {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@');
  let name = local.split('+')[0]!;
  if (domain === 'gmail.com' || domain === 'googlemail.com') name = name.replaceAll('.', '');
  const normalised = `${name}@${domain === 'googlemail.com' ? 'gmail.com' : domain}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(bindings.BETTER_AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(normalised));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
}

function otpEmail(otp: string, type: string): string {
  const purpose =
    type === 'forget-password'
      ? 'reset your password'
      : type === 'email-verification'
        ? 'confirm your email address'
        : type === 'change-email'
          ? 'confirm your new email address'
          : 'sign in';
  return [
    `Your code to ${purpose} is:`,
    '',
    `    ${otp}`,
    '',
    'It expires in 10 minutes. If you did not ask for this code, you can ignore this email.',
    'We will never ask you for this code by phone or message.',
  ].join('\n');
}
