import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Extends app.json with values that differ per developer or per build and must not be
 * hard-coded: Google Sign-In's iOS URL scheme (from Google Cloud Console).
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;
  const plugins = (config.plugins ?? []).map((p) =>
    p === '@react-native-google-signin/google-signin' && iosUrlScheme ? ['@react-native-google-signin/google-signin', { iosUrlScheme }] : p,
  );
  return { ...config, plugins } as ExpoConfig;
};
