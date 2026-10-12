import { Platform } from 'react-native';
import Purchases, {
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';
import type { Entitlements } from '@translator/shared';
import { ApiError } from './api';
import { REVENUECAT_KEYS } from './config';
import { getState, setState } from './store';
import { refreshEntitlements } from './translator';

/**
 * In-app purchases through RevenueCat. The RevenueCat user id is our account id, so the
 * server (via webhook) can attach every purchase to the right account. Purchases require
 * sign-in so they are never lost with an anonymous id.
 */

const apiKey = Platform.OS === 'ios' ? REVENUECAT_KEYS.ios : REVENUECAT_KEYS.android;
let configured = false;
/** The signed-in account RevenueCat should be logged in as (set by identify). */
let accountId: string | null = null;

export const purchasesEnabled = apiKey.length > 0;

/**
 * Failures are RevenueCat's own errors (errors.ts maps their codes), plus two of ours:
 * PURCHASES_UNAVAILABLE when the store is not set up in this build, and an "unauthorized"
 * ApiError when nobody is signed in, so the UI offers sign-in.
 */
function purchasesUnavailable(): Error {
  return Object.assign(new Error('PURCHASES_UNAVAILABLE'), { code: 'PURCHASES_UNAVAILABLE' });
}

const C = PURCHASES_ERROR_CODE;

function isCancelled(err: unknown): boolean {
  const e = err as { code?: unknown; userCancelled?: unknown } | null;
  return e?.userCancelled === true || e?.code === C.PURCHASE_CANCELLED_ERROR;
}

export function configurePurchases(): void {
  if (!purchasesEnabled || configured) return;
  try {
    Purchases.configure({ apiKey, appUserID: accountId ?? undefined });
    configured = true;
  } catch {
    // No native module (Expo Go, web): purchases stay unavailable.
  }
}

/** Logs RevenueCat in as the signed-in account (or out). Never rejects. */
export async function identify(userId: string | null): Promise<void> {
  accountId = userId;
  if (!configured) return;
  try {
    if (userId) await Purchases.logIn(userId);
    else if (!(await Purchases.isAnonymous())) await Purchases.logOut();
  } catch {
    // RevenueCat is unavailable (no network); buy() and restore() log in again first.
  }
}

/** Makes sure purchases attach to the signed-in account, never to an anonymous id. */
async function ensureAccount(): Promise<void> {
  if (!configured) throw purchasesUnavailable();
  if (!accountId) throw new ApiError(401, 'unauthorized', 'Sign in to buy or restore purchases');
  if ((await Purchases.getAppUserID()) !== accountId) await Purchases.logIn(accountId);
}

export async function getOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current ?? null;
}

/* ------------------------------------------------------------------ crediting */

const SYNC_INTERVAL_MS = 1200;
const SYNC_ATTEMPTS = 6;
let syncRun = 0;

/** The purchase shows up: more credits or passes, or a different plan. Spending in between is not it. */
function credited(before: Entitlements | null, after: Entitlements): boolean {
  if (!before) return false; // Nothing to compare with: poll the whole window.
  return (
    after.balance > before.balance ||
    after.passesAvailable > before.passesAvailable ||
    after.tier !== before.tier ||
    JSON.stringify(after.subscription) !== JSON.stringify(before.subscription) ||
    JSON.stringify(after.pass) !== JSON.stringify(before.pass)
  );
}

/**
 * The server credits a purchase from RevenueCat's webhook, usually within a second or two.
 * Polls briefly in the background with `entitlementsSyncing` set, so a screen can show
 * "updating balance" without waiting (or staying open) for it.
 */
async function waitForCredit(before: Entitlements | null): Promise<void> {
  const run = ++syncRun;
  setState({ entitlementsSyncing: true });
  try {
    for (let i = 0; i < SYNC_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, SYNC_INTERVAL_MS));
      if (run !== syncRun) return; // A newer purchase took over.
      const now = await refreshEntitlements();
      if (!now || credited(before, now)) return; // Signed out, or credited.
    }
  } finally {
    if (run === syncRun) setState({ entitlementsSyncing: false });
  }
}

/**
 * Buys a package. Resolves true as soon as the store confirms (false if the user
 * cancelled); the new balance arrives in the background, see `entitlementsSyncing`.
 * Rejects with RevenueCat's error, e.g. PAYMENT_PENDING_ERROR for Ask to Buy or a pending payment.
 */
export async function buy(pkg: PurchasesPackage): Promise<boolean> {
  await ensureAccount();
  const before = getState().entitlements;
  try {
    await Purchases.purchasePackage(pkg);
  } catch (err) {
    if (isCancelled(err)) return false;
    throw err;
  }
  void waitForCredit(before).catch(() => {});
  return true;
}

function hasAnything(info: CustomerInfo): boolean {
  return (
    Object.keys(info.entitlements.active).length > 0 ||
    info.activeSubscriptions.length > 0 ||
    info.nonSubscriptionTransactions.length > 0
  );
}

/**
 * Restores store purchases to the signed-in account. Resolves true when the store had
 * something to restore, false when there was nothing.
 */
export async function restore(): Promise<boolean> {
  await ensureAccount();
  const info = await Purchases.restorePurchases();
  await refreshEntitlements();
  return hasAnything(info);
}

const STORE_SUBSCRIPTIONS_URL = Platform.select({
  ios: 'https://apps.apple.com/account/subscriptions',
  android: 'https://play.google.com/store/account/subscriptions',
});

/**
 * Where the user manages their subscription. Falls back to the store's own subscriptions
 * page when RevenueCat has no URL or cannot be reached. Never rejects.
 */
export async function manageSubscriptionsUrl(): Promise<string | null> {
  if (configured) {
    try {
      const url = (await Purchases.getCustomerInfo()).managementURL;
      if (url) return url;
    } catch {
      // Offline: the store page works without RevenueCat.
    }
  }
  return STORE_SUBSCRIPTIONS_URL ?? null;
}
