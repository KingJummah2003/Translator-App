# Privacy

This is both an inventory of what the system stores (for you) and the basis of the privacy policy
you publish (for users). Have a lawyer review the published version for the countries you sell in.

## What we never collect

- **The text you translate**: typed, spoken, photographed or uploaded. Cloud requests are processed in
  memory and discarded. The API never logs request bodies; only counts are stored.
- **Audio**: speech recognition runs through the phone's own service (on the device when supported).
  The app never records or uploads audio.
- **Photos and documents** are never stored on our servers.
- **Advertising or tracking identifiers**: there are no ads, no third-party analytics and no tracking SDKs.

## What we store on the server (Cloudflare D1, EU jurisdiction)

| Data | Why | Kept |
|---|---|---|
| Email, name, sign-in method | Your account | Until you delete it |
| Session records (creation time, device type, IP address) | Keeping you signed in, security | Until the session ends (at most 60 days) |
| Subscription status, purchases, 3-hour passes | Giving you what you paid for | Account lifetime; purchase records are kept **unlinked** after deletion for tax and accounting |
| Credit balance and credit history | Billing and support | Until you delete your account |
| Daily usage counts (requests, characters, credits) | Fair use and cost control | 400 days, then deleted automatically |
| Admin actions on your account | Accountability | Kept for audit |

## What stays on your phone

- Translation history: encrypted with SQLCipher; the key is held in the iOS Keychain / Android Keystore.
  You can switch history off or clear it in Account → Privacy.
- The dictionary cache and downloaded language models.
- The sign-in session, in the Keychain / Keystore.

## Third parties (processors)

| Service | Receives | Purpose |
|---|---|---|
| Google Cloud Translation and Vision | Text or image of a cloud request | Cloud translation and text recognition (not used on device) |
| Google ML Kit (on device) | Nothing; language models are downloaded from Google | Offline translation |
| Wiktionary (via our server) | The looked-up word, without your IP address | Dictionary |
| Apple / Google | Sign-in tokens, payments | Sign in, in-app purchases |
| RevenueCat | Your account ID and purchase receipts | Validating purchases |
| Resend | Your email address and a one-time code | Sign-in emails |
| Cloudflare | Hosting all of the above | Infrastructure |

## Your rights

- **Download your data**: Account → Download my data (JSON).
- **Delete your account**: Account → Delete account. This deletes everything above except unlinked
  purchase records, and removes you from RevenueCat. Active App Store / Google Play subscriptions must
  be cancelled in the store, as the app explains.
- **Use without an account**: offline translation, speech, camera recognition on the device and the
  dictionary cache all work signed out.
