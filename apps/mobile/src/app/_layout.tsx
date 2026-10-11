import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppLock } from '@/components/AppLock';
import { authClient } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { configurePurchases, identify } from '@/lib/purchases';
import { loadPersisted, setState, useAppState } from '@/lib/store';
import { refreshDownloadedModels, refreshEntitlements } from '@/lib/translator';
import { palette, useIsDark } from '@/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const dark = useIsDark();
  const ready = useAppState((s) => s.ready);
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;
  const c = palette[dark ? 'dark' : 'light'];

  useEffect(() => {
    configurePurchases();
    Promise.all([loadPersisted(), refreshDownloadedModels()])
      .catch(() => setState({ ready: true }))
      .finally(() => SplashScreen.hideAsync());
  }, []);

  useEffect(() => {
    void identify(userId);
    if (userId) void refreshEntitlements();
    else setState({ entitlements: null });
  }, [userId]);

  const theme = dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...theme,
    colors: { ...theme.colors, background: c.bg, card: c.bg, text: c.text, border: c.border, primary: c.accent },
  };

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={navTheme}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShadowVisible: false, headerTintColor: c.accent, headerTitleStyle: { color: c.text } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="languages"
            options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, headerShown: false }}
          />
          <Stack.Screen
            name="word"
            options={{ presentation: 'formSheet', sheetAllowedDetents: [0.5, 0.9], sheetGrabberVisible: true, headerShown: false }}
          />
          <Stack.Screen name="sign-in" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="plans" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="offline" options={{ title: t('offlineLanguages'), headerBackTitle: t('tabAccount') }} />
          <Stack.Screen name="history" options={{ title: t('recent'), headerBackTitle: t('tabTranslate') }} />
        </Stack>
        <AppLock />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
