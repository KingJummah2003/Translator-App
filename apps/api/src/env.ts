/** Bindings and secrets available to the Worker. Secrets are set with `wrangler secret put`. */
export interface Env {
  DB: D1Database;
  /** Per-tier request limits (requests per 60 s), configured in wrangler.jsonc. */
  LIMIT_FREE: RateLimit;
  LIMIT_PAID: RateLimit;
  LIMIT_PRO: RateLimit;
  LIMIT_VIP: RateLimit;
  /** Per-IP limit for sign-in and other public endpoints. */
  LIMIT_PUBLIC: RateLimit;

  ENVIRONMENT: 'development' | 'production';
  /** Public URL of this API, e.g. https://api.example.com */
  API_URL: string;
  /** Origins allowed to call the API from a browser (the admin portal). Comma separated. */
  ADMIN_ORIGINS: string;
  /** 'mymemory' is a free dev-only service so the iOS Simulator gets real translations. */
  TRANSLATION_PROVIDER: 'google' | 'mock' | 'mymemory';
  /** Mobile app deep-link scheme used by Better Auth redirects. */
  APP_SCHEME: string;

  // Secrets
  BETTER_AUTH_SECRET: string;
  GOOGLE_API_KEY?: string;
  REVENUECAT_WEBHOOK_AUTH: string;
  REVENUECAT_SECRET_KEY?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_APP_BUNDLE_ID?: string;
  GOOGLE_OAUTH_CLIENT_IDS?: string;
  /** Resend API key used to email one-time codes. */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Cloudflare Access team domain and application audience for the admin portal. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Local development only (.dev.vars): lets the admin portal work without Cloudflare Access. */
  ADMIN_DEV_BYPASS?: string;
  /** Comma-separated user ids whose App Store / Play sandbox purchases count (testers). */
  SANDBOX_USER_IDS?: string;
}

export interface Variables {
  user: { id: string; email: string; role?: string | null };
  requestId: string;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
