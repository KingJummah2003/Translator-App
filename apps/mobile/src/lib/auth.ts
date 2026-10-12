import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import * as SecureStore from 'expo-secure-store';
import { API_URL, APP_SCHEME } from './config';

/**
 * Session cookies are kept in the iOS Keychain / Android Keystore via SecureStore,
 * readable only by this app and never backed up to other devices.
 */
const storage = {
  getItem: (key: string) => SecureStore.getItem(key, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  setItem: (key: string, value: string) =>
    SecureStore.setItem(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  getItemAsync: (key: string) =>
    SecureStore.getItemAsync(key, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  setItemAsync: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
};

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [expoClient({ scheme: APP_SCHEME, storagePrefix: 'translator', storage }), emailOTPClient()],
});

export type SessionUser = NonNullable<ReturnType<typeof authClient.useSession>['data']>['user'];
