import { Platform } from 'react-native';
import Purchases, { type PurchasesOffering, type PurchasesPackage } from 'react-native-purchases';
import { REVENUECAT_KEYS } from './config';
import { refreshEntitlements } from './translator';

/**
 * In-app purchases through RevenueCat. The RevenueCat user id is our account id, so the
 * server (via webhook) can attach every purchase to the right account. Purchases require
 * sign-in so they are never lost with an anonymous id.
 */

const apiKey = Platform.OS === 'ios' ? REVENUECAT_KEYS.ios : REVENUECAT_KEYS.android;
let configured = false;

export const purchasesEnabled = apiKey.length > 0;

export function configurePurchases(): void {
  if (!purchasesEnabled || configured) return;
  Purchases.configure({ apiKey });
  configured = true;
}

export async function identify(userId: string | null): Promise<void> {
  if (!configured) return;
  try {
    if (userId) await Purchases.logIn(userId);
    else if (!(await Purchases.isAnonymous())) await Purchases.logOut();
  } catch {
    // RevenueCat is unavailable (no network); it will retry on the next launch.
  }
}

export async function getOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current ?? null;
}

/** Buys a package. Returns false if the user cancelled. Credits arrive via the server webhook. */
export async function buy(pkg: PurchasesPackage): Promise<boolean> {
  try {
    await Purchases.purchasePackage(pkg);
  } catch (err) {
    if ((err as { userCancelled?: boolean }).userCancelled) return false;
    throw err;
  }
  // The webhook usually lands within a second or two; poll briefly for the new balance.
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    await refreshEntitlements();
  }
  return true;
}

export async function restore(): Promise<void> {
  if (!configured) return;
  await Purchases.restorePurchases();
  await refreshEntitlements();
}

export async function manageSubscriptionsUrl(): Promise<string | null> {
  if (!configured) return null;
  return (await Purchases.getCustomerInfo()).managementURL;
}
