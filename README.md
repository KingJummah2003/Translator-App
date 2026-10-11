# Translator

A private, offline-first translation app for iOS and Android, with cloud translation for
every language, accounts, in-app purchases and an admin portal.

| Folder | What it is |
|---|---|
| `apps/mobile` | Expo SDK 57 app (iOS + Android). English and Arabic interface, right-to-left aware. |
| `apps/mobile/modules/translator-native` | Native module (Swift + Kotlin): on-device translation and language detection with Google ML Kit, text recognition with Apple Vision (iOS) and ML Kit (Android). |
| `apps/api` | Cloudflare Worker (Hono + D1 + Better Auth): accounts, credits, purchases webhook, cloud translation, dictionary, admin API. |
| `apps/admin` | Admin portal (Vite + React) served by a Worker behind Cloudflare Access. |
| `packages/shared` | Plans, prices, credit costs, the language list and the Word/text document engine, shared by all three. |

## Features

- **Typing translation**: live and free when both languages are downloaded; cloud translation on request.
- **Speech to text** on the device where supported, and **read aloud**.
- **Camera translation**: on-device text recognition, cloud fallback for scripts the phone can't read.
- **Conversation mode**: face-to-face split screen with automatic read-aloud.
- **Document translation**: Word (.docx) and text files, keeping formatting; offline or cloud.
- **Tap-a-word dictionary** (Wiktionary), cached on the phone for offline use.
- **Offline language manager**: about 30 MB per language, Wi-Fi-only downloads.
- **Accounts**: Apple, Google, email one-time code, or email and password.
- **Purchases**: weekly, monthly and yearly Pro; VIP with credits that reset every Monday; credit packs; 3-hour session passes.

## How payment works

Every cloud action costs credits (1 credit ≈ 500 characters; a camera scan is 2). Credits sit in
*buckets* on the server and the one that expires soonest is spent first:

| Bucket | Comes from | Expires |
|---|---|---|
| `pass` | 3-hour session pass (150 credits) | When the pass ends |
| `sub_daily` | Pro subscription (200 per day) | Midnight UTC |
| `vip_weekly` | VIP subscription (3,000 per week) | Monday 00:00 UTC |
| `grant` | Welcome gift, support | Never |
| `purchased` | Credit packs | Never |

Charging is atomic in D1 (a `CHECK (balance >= 0)` constraint rejects races), failures are refunded
automatically, and every change is written to a ledger. Amounts live in
[`packages/shared/src/plans.ts`](packages/shared/src/plans.ts).

**Cost protection**: per-plan rate limits (10–90 requests per minute), per-request size limits, a daily
character and image cap for the whole service, and an emergency stop in the admin portal.

## Running locally

Requirements: Node 22+, Xcode (iOS), Android Studio (Android), CocoaPods.

```bash
npm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # then fill in two random secrets
npm run db:migrate:local --workspace api
npm run api        # API on http://localhost:8790 (mock translator, emails printed to the console)
npm run admin      # Admin portal on http://localhost:5173 (no Access check locally)
npm run mobile     # Metro bundler; build the app once with:
cd apps/mobile && npx expo run:ios     # or run:android
```

The local API uses a **mock translator** (it echoes `[ar] your text`) and prints sign-in codes to the
terminal instead of emailing them, so no paid account is needed for development.

> **iOS Simulator note.** Google ML Kit has no build for the Apple-silicon Simulator, so in the
> Simulator offline translation is switched off and the app uses the cloud. Test offline
> translation on a real iPhone. Text recognition (Apple Vision) works in the Simulator.

## Tests

```bash
npm test          # shared package (12) + API in the real Workers runtime (24)
npm run typecheck # every workspace
```

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md) for the accounts to create and the order to do things in.
Privacy and security notes are in [docs/PRIVACY.md](docs/PRIVACY.md) and [docs/SECURITY.md](docs/SECURITY.md).
