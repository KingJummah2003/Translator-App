import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { TranslatorNative } from 'translator-native';

const configured = (
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  ''
).replace(/\/+$/, '');

/** The API base URL. The Android emulator reaches the host machine at 10.0.2.2, not localhost. */
export const API_URL =
  Platform.OS === 'android' ? configured.replace('://localhost', '://10.0.2.2') : configured;

export const APP_SCHEME = 'translator';

export const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL ?? 'https://example.com/privacy';
export const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL ?? 'https://example.com/terms';

export const REVENUECAT_KEYS = {
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '',
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '',
};

const GOOGLE_PLUGIN = '@react-native-google-signin/google-signin';

/** URL schemes this binary registered (iOS), or null when unknown. Runs at import: never throws. */
function registeredUrlSchemes(): string[] | null {
  try {
    return TranslatorNative.urlSchemes();
  } catch {
    return null;
  }
}

/**
 * The reversed-client-ID URL scheme app.config.ts passed to the Google Sign-In plugin, if
 * any. Only the plugin registers the scheme, so an environment variable alone does not count.
 */
function googleIosUrlScheme(): string {
  for (const plugin of Constants.expoConfig?.plugins ?? []) {
    if (Array.isArray(plugin) && plugin[0] === GOOGLE_PLUGIN) {
      const scheme = (plugin[1] as { iosUrlScheme?: unknown } | undefined)?.iosUrlScheme;
      if (typeof scheme === 'string') return scheme;
    }
  }
  return '';
}

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
const iosUrlScheme = googleIosUrlScheme();

/**
 * Whether "Continue with Google" can work in this build. On iOS, GIDSignIn aborts a release
 * build when the reversed client ID is not registered as a URL scheme, so both must match.
 * On Android an empty web client ID silently returns no ID token.
 */
function googleSignInReady(): boolean {
  if (Platform.OS === 'ios') {
    const reversed = `com.googleusercontent.apps.${iosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}`;
    // A stale prebuild can lack the URL type even when the config has it; null means unknown.
    const registered = registeredUrlSchemes();
    return iosClientId.length > 0 && iosUrlScheme === reversed && (registered === null || registered.includes(reversed));
  }
  if (Platform.OS === 'android') return webClientId.length > 0;
  return false;
}

export const GOOGLE_SIGN_IN = {
  webClientId,
  iosClientId,
  iosUrlScheme,
  /** Show the Google button only when this is true. */
  available: googleSignInReady(),
};

/** False in builds signed by a free Apple ID (PERSONAL_TEAM=1), which cannot use Sign in with Apple. */
export const APPLE_SIGN_IN_ENABLED = Platform.OS === 'ios' && Constants.expoConfig?.extra?.appleSignIn !== false;
