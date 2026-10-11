# Deploying Translator

Do these in order. Steps marked **(you)** need you to create an account or accept terms, which only
you can do. Everything else is commands in this repo.

Replace `example.com` with your domain throughout (for example `api.jum3ah.com` and
`admin.jum3ah.com`, since your domain is already on Cloudflare).

---

## 1. Choose the app's identity (you)

`com.translator.app` (the bundle ID in `apps/mobile/app.json`) is generic and is probably already taken
on the App Store. Pick your own, for example `com.jum3ah.translator`, and change it in `app.json`
(`ios.bundleIdentifier` and `android.package`) **before** creating anything in Apple or Google.
It can't be changed after release.

## 2. Cloudflare: database and API

```bash
cd apps/api
npx wrangler login
npx wrangler d1 create translator --jurisdiction=eu        # data stays in the EU
```

1. Copy the printed `database_id` into **both** `d1_databases` blocks in `wrangler.jsonc`.
2. In `env.production.vars`, set `API_URL` (e.g. `https://api.example.com`) and `ADMIN_ORIGINS`.
3. Apply the tables and set the secrets:

```bash
npx wrangler d1 migrations apply translator --remote --env production
openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET --env production
echo "Bearer $(openssl rand -hex 24)" | tee /dev/stderr | npx wrangler secret put REVENUECAT_WEBHOOK_AUTH --env production
npx wrangler deploy --env production
```

Save the `Bearer …` value it prints; RevenueCat needs it in step 7.
Then in the Cloudflare dashboard → Workers → `translator-api` → **Settings → Domains**, add `api.example.com`.

The Workers **Paid plan ($5/month)** is required: password hashing needs more CPU than the free plan allows.

## 3. Google Cloud: translation and camera text (you)

1. Create a project at console.cloud.google.com and enable **Cloud Translation API** and **Cloud Vision API**.
2. Create an **API key** and restrict it to those two APIs only.
3. Set a **budget alert** (Billing → Budgets) so you hear about cost spikes early.

```bash
npx wrangler secret put GOOGLE_API_KEY --env production
```

## 4. Email for sign-in codes (you)

1. Create a Resend account and verify a sending domain. Resend gives you DNS records to add in Cloudflare.
2. Then:

```bash
npx wrangler secret put RESEND_API_KEY --env production
echo "Translator <no-reply@example.com>" | npx wrangler secret put EMAIL_FROM --env production
```

## 5. Apple (you)

1. Join the **Apple Developer Program** ($99/year).
2. Certificates, IDs & Profiles → Identifiers: register your bundle ID with **Sign in with Apple**.
3. App Store Connect → create the app → **In-App Purchases / Subscriptions**. Use these product IDs exactly:

| Product ID | Type | Notes |
|---|---|---|
| `pro_weekly`, `pro_monthly`, `pro_yearly` | Auto-renewable subscription | Put Pro **and** VIP in one subscription group so users can upgrade or downgrade |
| `vip_monthly`, `vip_yearly` | Auto-renewable subscription | Same group, ranked above Pro |
| `credits_100`, `credits_500`, `credits_2000` | Consumable | |
| `pass_3h` | Consumable | |

4. Set the Apple sign-in secrets:

```bash
echo "com.yourname.translator" | npx wrangler secret put APPLE_CLIENT_ID --env production
echo "com.yourname.translator" | npx wrangler secret put APPLE_APP_BUNDLE_ID --env production
```

## 6. Google Play and Google Sign-In (you)

1. **Google Play Console** ($25 once): create the app and the same products. Subscriptions need a base plan each.
2. In Google Cloud → APIs & Services → Credentials, create **OAuth client IDs**:
   - a **Web** client;
   - an **iOS** client (your bundle ID);
   - an **Android** client (your package name plus the SHA-1 from `eas credentials`).
3. Set the secrets:

```bash
echo "WEB_ID,IOS_ID,ANDROID_ID" | npx wrangler secret put GOOGLE_OAUTH_CLIENT_IDS --env production
```

4. For the app build, set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and
   `GOOGLE_IOS_URL_SCHEME` (the iOS client's "iOS URL scheme") as EAS environment variables.

## 7. RevenueCat (you)

1. Create a project and connect App Store Connect and Google Play.
2. Import the products.
3. Create **entitlements** `pro` (the Pro products) and `vip` (the VIP products).
4. Create an **offering** named `default` containing all nine products as packages.
5. Integrations → **Webhooks**:
   - URL: `https://api.example.com/webhooks/revenuecat`
   - Authorization header: the `Bearer …` value from step 2.
6. Send a test event. The admin portal's audit and purchase pages will show live data from then on.
7. Set the server secret and the app's public keys:

```bash
npx wrangler secret put REVENUECAT_SECRET_KEY --env production   # secret key (sk_...)
```

Set `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (public `appl_` / `goog_` keys) as EAS variables.

## 8. Admin portal behind Cloudflare Access

```bash
cd apps/admin && npm run deploy
```

1. Add the domain `admin.example.com` to the `translator-admin` Worker.
2. In **Zero Trust → Access → Applications**, add a **self-hosted** application for `admin.example.com`:
   - Policy: allow only your email(s), and require a login method with 2-factor.
   - Copy the application's **AUD tag**.
3. Then:

```bash
cd apps/api
echo "yourteam.cloudflareaccess.com" | npx wrangler secret put ACCESS_TEAM_DOMAIN --env production
npx wrangler secret put ACCESS_AUD --env production
```

The API checks the signed Access token on every admin request, so even a direct call to
`api.example.com/admin/...` is refused.

## 9. Build and submit the app

1. Set `EXPO_PUBLIC_API_URL` in `apps/mobile/eas.json` (production and preview).
2. Publish a privacy policy page (use [PRIVACY.md](PRIVACY.md)) and set `EXPO_PUBLIC_PRIVACY_URL` / `EXPO_PUBLIC_TERMS_URL`.
3. Build:

```bash
cd apps/mobile
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --profile production --platform all
```

4. App Store privacy label:
   - Collected: email address, user ID, purchase history, product interaction (usage counts), all **linked to the user** and **not used for tracking**.
   - Translated text is **not collected**.

## 10. Pricing worksheet

Google charges about **$20 per million characters** for translation and **$1.50 per 1,000 images** for
text recognition. Both have a monthly free tier; check current prices. **One credit = 500 characters,
which costs you about $0.01.**

| Product | Allowance | Your worst-case cost | Suggested price |
|---|---|---|---|
| 3-hour pass | 150 credits | $1.50 | $2.99 |
| Credits 100 / 500 / 2000 | 100 / 500 / 2,000 | $1 / $5 / $20 | $1.99 / $7.99 / $24.99 |
| Pro (200 credits/day) | 6,000 credits/month | **$60/month** | see note |
| VIP (3,000 credits/week) | ~13,000 credits/month | **$130/month** | see note |

**Note on subscriptions:** most subscribers use a small fraction of their allowance, but the worst case
above is real. Either price for it, or lower `proDailyCredits` / `vipWeeklyCredits` in
`packages/shared/src/plans.ts`. For example, 60 a day for Pro at $9.99/month, or 1,000 a week for VIP
at $24.99/month. On-device translation costs you nothing, which is why the app always prefers it.
The daily service cap (admin portal → Service settings) is the final safety net.

## Pre-launch checklist

- [ ] Bundle ID / package changed to your own (step 1)
- [ ] Sandbox purchases of every product tested on a real iPhone and Android phone
- [ ] Refund of a credit pack tested (credits are clawed back)
- [ ] Offline translation tested on a real iPhone (the Simulator can't run ML Kit)
- [ ] Daily caps set in the admin portal
- [ ] Budget alert set in Google Cloud
- [ ] Privacy policy and terms published
