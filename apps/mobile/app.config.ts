import type { ConfigContext, ExpoConfig } from 'expo/config';

type PluginEntry = NonNullable<ExpoConfig['plugins']>[number];

const GOOGLE_SIGN_IN_PLUGIN = '@react-native-google-signin/google-signin';
const APPLE_AUTH_PLUGIN = 'expo-apple-authentication';

/** "123-abc.apps.googleusercontent.com" -> "com.googleusercontent.apps.123-abc" */
function reversedClientId(clientId: string): string {
  return `com.googleusercontent.apps.${clientId.replace(/\.apps\.googleusercontent\.com$/, '')}`;
}

/**
 * Extends app.json with values that differ per developer or per build and must not be
 * hard-coded: Google Sign-In's iOS URL scheme (from Google Cloud Console).
 *
 * GIDSignIn aborts an iOS release build whose reversed client ID is not a registered URL
 * scheme, so the Google Sign-In plugin (which registers it) is only included when
 * GOOGLE_IOS_URL_SCHEME is set. Without it the app hides "Continue with Google" on iOS:
 * src/lib/config.ts reads this plugin entry from the embedded config (GOOGLE_SIGN_IN.available).
 *
 * PERSONAL_TEAM=1 makes a build a free Apple ID can sign for a developer's own iPhone: a
 * unique bundle ID (IOS_BUNDLE_ID, since com.translator.app belongs to the paid team) and no
 * Sign in with Apple, which free teams cannot use. APPLE_TEAM_ID sets the signing team.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME?.trim() ?? '';
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? '';

  if (iosClientId && !iosUrlScheme) {
    console.warn('[app.config] EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is set but GOOGLE_IOS_URL_SCHEME is not: Google Sign-In is off on iOS.');
  } else if (iosClientId && iosUrlScheme !== reversedClientId(iosClientId)) {
    console.warn(`[app.config] GOOGLE_IOS_URL_SCHEME should be ${reversedClientId(iosClientId)}: Google Sign-In is off on iOS.`);
  }

  const personal = process.env.PERSONAL_TEAM === '1';
  const plugins = (config.plugins ?? []).flatMap((entry): PluginEntry[] => {
    const name = Array.isArray(entry) ? entry[0] : entry;
    if (name === APPLE_AUTH_PLUGIN && personal) return [];
    if (name !== GOOGLE_SIGN_IN_PLUGIN) return [entry];
    return iosUrlScheme ? [[GOOGLE_SIGN_IN_PLUGIN, { iosUrlScheme }]] : [];
  });
  const ios = {
    ...config.ios,
    ...(personal ? { bundleIdentifier: process.env.IOS_BUNDLE_ID || 'com.hjum3ah.translator.personal', usesAppleSignIn: false } : {}),
    ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
  };
  const extra = { ...config.extra, appleSignIn: !personal };
  if (personal) plugins.push('./plugins/with-personal-team');
  return { ...config, ios, extra, plugins } as ExpoConfig;
};
