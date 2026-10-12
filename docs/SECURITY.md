# Security design

## Secrets

- No secret is ever shipped in the app. The translation, RevenueCat secret and email keys exist only as
  Worker secrets (`wrangler secret put`). `EXPO_PUBLIC_*` values are public identifiers by design.
- `.dev.vars`, `.env*`, keystores and provisioning files are git-ignored.

## Accounts and sessions (Better Auth)

- Sign-in with Apple and Google uses **native ID tokens verified on the server**: signature, issuer,
  audience, and for Apple a hashed nonce, which prevents replaying a stolen token.
- Email codes are 6 digits, stored **hashed**, valid for 10 minutes, with at most 5 attempts.
- Passwords: at least 10 characters, hashed with scrypt. Password accounts must verify their email.
  A password reset signs out every other session.
- Sessions slide to 30 days from the last use and **end 60 days after sign-in regardless**. The 60-day
  limit is enforced twice: in a database hook and in the request middleware.
- Brute-force protection: per-route limits stored in D1 (for example 5 sign-in attempts per 5 minutes),
  plus a per-IP limit on every auth route at the edge.
- Suspended users are blocked at sign-in, all their sessions are removed, and API requests always read
  the session from the database, so bans and "sign out everywhere" apply instantly.
- Better Auth's built-in admin endpoints are disabled. Admin work only happens through the
  Access-protected, audited admin API.
- Deploy safety: the development config has a different Worker name. Development-only behaviour
  (mock translator, console emails, admin bypass) needs an explicit `ENVIRONMENT=development`; the
  admin bypass also needs `ADMIN_DEV_BYPASS=1` and a localhost request.

## Money

- **The server is the only source of truth for credits.** The app never reports what the user bought;
  purchases arrive from RevenueCat's webhook, which is authenticated with a secret compared in constant
  time.
- Each webhook event ID is applied once. Each store transaction ID can grant credits only once: a
  `UNIQUE` constraint plus an atomic batch.
- Subscription state is re-read from RevenueCat's API on every event, so forged or out-of-order events
  can't grant a plan.
- Refunds claw back unspent credits and end passes immediately, in one atomic step that a retried or
  duplicated webhook can't repeat.
- Subscription allowances belong to the subscription. They are removed when it ends, is refunded or
  changes tier, and moved (not re-granted) when it transfers to another account.
- Sandbox (test) purchases only count for allow-listed tester accounts in production.
- Welcome credits are given once per email address (a keyed hash survives account deletion; `+tags`
  and Gmail dots are normalised).
- Charging is atomic: `CHECK (balance >= 0)` makes concurrent requests unable to overspend (covered by
  a test that races six requests).

## Cost and abuse controls

- Per-plan rate limits (10 to 90 requests a minute, Cloudflare Rate Limiting).
- Per-request limits: 5,000 characters of text, 4 MB images, 10 MB documents, and a per-plan document
  length limit. Body sizes are enforced while streaming, so chunked uploads can't bypass them.
- Word files: unpacked-size, text-size and paragraph-count limits, which protect against zip bombs and
  memory exhaustion.
- A separate daily cap for free accounts, so free usage can't consume the paying users' budget.
- Failed provider calls are refunded to the user but still counted toward the daily cap.
- A global daily cap on characters and images, plus an emergency stop, both in the admin portal.
- Charge happens before the provider call, with an automatic refund on failure, so failures never cost users.

## Admin portal

- Behind **Cloudflare Access** (single sign-on and 2-factor). The API verifies the signed Access JWT
  (issuer, audience and signature) on every admin request rather than trusting the network path.
- Strict Content-Security-Policy, `frame-ancestors 'none'`, no third-party scripts, `noindex`.
- Every change is written to `admin_audit` with the admin's email and the reason. Large credit changes
  need a confirmation.

## Mobile app

- Local database encrypted with SQLCipher. Its random key is stored in the Keychain / Keystore as
  "after first unlock, this device only", so it is not migrated to other devices.
- Android: `allowBackup` is false; storage, location and overlay permissions are explicitly blocked.
- iOS privacy manifest declares the data collected and the required-reason APIs used.
- API errors shown to users are generic; internal errors are logged on the server without request content.

## Reporting

Add a `security@` address to the published privacy policy and app listing.
