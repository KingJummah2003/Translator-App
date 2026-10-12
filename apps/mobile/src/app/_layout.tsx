import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { unstable_getMaterialSymbolSourceAsync } from 'expo-symbols';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppLock } from '@/components/AppLock';
import { EmptyState } from '@/components/EmptyState';
import { iconNames } from '@/components/Icon';
import { duration } from '@/components/motion';
import { authClient } from '@/lib/auth';
import { directionReloadPending, t, useReloadOnLanguageChange } from '@/lib/i18n';
import { configurePurchases, identify } from '@/lib/purchases';
import { loadPersisted, setState, useAppState } from '@/lib/store';
import { refreshDownloadedModels, refreshEntitlements } from '@/lib/translator';
import { iconSize, palette, radius, useColors, useIsDark } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
// The splash dissolves into the first screen instead of cutting to it.
SplashScreen.setOptions({ fade: true, duration: duration.base });

/** Launch work that only polishes the first frame gets this long before the splash hides anyway. */
const PREPARE_BUDGET_MS = 1200;
/** If the Android layout-direction reload never happens, carry on in the current direction. */
const RELOAD_FALLBACK_MS = 3000;

/** Resolves when `work` settles or after `ms`, whichever is first. Never rejects. */
function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    work
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

/**
 * Android draws the tab bar and every <Icon> from the Material Symbols font, which loads
 * asynchronously. Loading it under the splash means the first frame has its icons.
 */
async function loadIconFont(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await unstable_getMaterialSymbolSourceAsync(iconNames('translate').android, iconSize.lg, 'white');
}

let splashHidden = false;

/**
 * Hides the splash once, one frame after the app's first layout, so the dissolve reveals a
 * painted screen (safe areas applied, tab bar drawn) rather than its first, unstyled frame.
 */
function hideSplash(): void {
  if (splashHidden) return;
  splashHidden = true;
  requestAnimationFrame(() => {
    SplashScreen.hideAsync().catch(() => {});
  });
}

export default function RootLayout() {
  const dark = useIsDark();
  const c = palette[dark ? 'dark' : 'light'];
  const ready = useAppState((s) => s.ready);
  const [prepared, setPrepared] = useState(false);
  const [reloadStalled, setReloadStalled] = useState(false);
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;

  // Android keeps the activity alive when the phone's languages change: reload so the strings
  // and the layout direction follow.
  useReloadOnLanguageChange();

  useEffect(() => {
    configurePurchases();
    // Settings (and with them App Lock) must be loaded before anything renders. The model list
    // and the icon font only avoid a visible change right after the splash, so they get a budget.
    Promise.all([
      loadPersisted(),
      settleWithin(refreshDownloadedModels(), PREPARE_BUDGET_MS),
      settleWithin(loadIconFont(), PREPARE_BUDGET_MS),
    ])
      .catch(() => setState({ ready: true }))
      .finally(() => setPrepared(true));
  }, []);

  useEffect(() => {
    void identify(userId);
    if (userId) void refreshEntitlements();
    else setState({ entitlements: null });
  }, [userId]);

  // Android shows the root view during blank frames and transitions. The window background is
  // themed natively but only follows a light/dark switch after a restart, so keep it in step.
  // (Not on iOS: there it is the backdrop behind page sheets, which should stay black.)
  useEffect(() => {
    if (Platform.OS === 'android') SystemUI.setBackgroundColorAsync(c.bg).catch(() => {});
  }, [c.bg]);

  useEffect(() => {
    if (!directionReloadPending) return;
    const timer = setTimeout(() => setReloadStalled(true), RELOAD_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, []);

  const theme = dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...theme,
    colors: { ...theme.colors, background: c.bg, card: c.bg, text: c.text, border: c.border, primary: c.accent },
  };

  // The splash stays up meanwhile; this themed view is only what sits underneath it.
  if (!ready || !prepared || (directionReloadPending && !reloadStalled)) {
    return <View style={[styles.flex, { backgroundColor: c.bg }]} />;
  }

  // Sheets and modals share one surface (c.sheet) so they separate from the page behind in dark
  // mode, and one corner radius on both platforms. Their content draws its own ModalHeader.
  const sheet = {
    presentation: 'formSheet',
    sheetGrabberVisible: true,
    sheetCornerRadius: radius.xl,
    headerShown: false,
    contentStyle: { backgroundColor: c.sheet },
  } as const;
  const modal = { presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: c.sheet } } as const;

  return (
    <GestureHandlerRootView style={[styles.flex, { backgroundColor: c.bg }]} onLayout={hideSplash}>
      <ThemeProvider value={navTheme}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <Stack
          unstable_screenErrorBoundary={CrashScreen}
          screenOptions={{
            contentStyle: { backgroundColor: c.bg },
            headerStyle: { backgroundColor: c.bg },
            headerShadowVisible: false,
            headerTintColor: c.accent,
            headerTitleStyle: { color: c.text },
            headerBackButtonDisplayMode: 'minimal',
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="languages" options={{ ...sheet, sheetAllowedDetents: [0.75, 1] }} />
          <Stack.Screen name="word" options={{ ...sheet, sheetAllowedDetents: [0.5, 0.9] }} />
          <Stack.Screen name="sign-in" options={modal} />
          <Stack.Screen name="plans" options={modal} />
          {/* Pushed pages draw their own ScreenHeader with a back button: the same look on both
              platforms, and a way out when opened from a link with nothing behind them. */}
          <Stack.Screen name="offline" options={{ title: t('offlineLanguages'), headerShown: false }} />
          <Stack.Screen name="history" options={{ title: t('history'), headerShown: false }} />
        </Stack>
        {/* After the Stack so it covers every screen; its own Modal also covers sheets. */}
        <AppLock />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Last line of defence against a render crash: instead of closing the app, the failing screen
 * (or, from the root, the whole app) shows a localized message with Try again.
 */
function CrashScreen({ retry }: ErrorBoundaryProps) {
  const c = useColors();
  return (
    <SafeAreaView style={[styles.flex, styles.center, { backgroundColor: c.bg }]} onLayout={hideSplash}>
      <EmptyState icon="error" tone="danger" title={t('error')} action={t('retry')} actionIcon="refresh" onAction={() => void retry()} />
    </SafeAreaView>
  );
}

export { CrashScreen as ErrorBoundary };

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { justifyContent: 'center' },
});
