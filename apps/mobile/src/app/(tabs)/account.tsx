import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as LocalAuthentication from 'expo-local-authentication';
import { router, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Entitlements } from '@translator/shared';
import { canUseBiometrics } from '@/components/AppLock';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { AnimatedNumber, LayoutAnimationConfig, Skeleton, enterFade, enterUp, exitFade, layoutTransition } from '@/components/motion';
import { Row, Section } from '@/components/Row';
import { Screen } from '@/components/Screen';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { announce } from '@/lib/a11y';
import { api, apiJson } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { PRIVACY_URL, TERMS_URL } from '@/lib/config';
import { clearHistory, wipeLocalData } from '@/lib/db';
import { errorActionLabel, errorCode, toAppError, type ErrorAction } from '@/lib/errors';
import { formatDate, formatNumber, t, tn, type StringKey } from '@/lib/i18n';
import { manageSubscriptionsUrl, restore } from '@/lib/purchases';
import { resetPreferences, setState, updateSettings, useAppState } from '@/lib/store';
import { refreshEntitlements, refreshEntitlementsIfStale } from '@/lib/translator';
import { radius, space, useColors } from '@/theme';

const TIER_LABEL: Record<Entitlements['tier'], StringKey> = {
  free: 'freePlan',
  credits: 'creditsPlan',
  pass: 'passPlan',
  pro: 'proPlan',
  vip: 'vipPlan',
};

type Action = 'pass' | 'lock' | 'history' | 'restore' | 'manage' | 'export' | 'signout' | 'delete';
/** Where an action's result appears: under the group the user acted in, so it is seen without scrolling. */
type Place = 'top' | 'privacy' | 'purchases' | 'account';
type Tone = 'success' | 'info' | 'warning' | 'danger';
/** Error follow-ups this screen can offer (the others belong to translation screens). */
type NoticeAction = Extract<ErrorAction, 'signIn' | 'getCredits' | 'openSettings' | 'restorePurchases'>;
const NOTICE_ACTIONS: readonly ErrorAction[] = ['signIn', 'getCredits', 'openSettings', 'restorePurchases'];
interface Notice {
  place: Place;
  tone: Tone;
  message: string;
  action?: NoticeAction;
}
/** What a finished action reports; nothing when its own UI already shows the result (share sheet, pass banner). */
type Outcome = { tone: Tone; message: string; place?: Place; action?: NoticeAction } | void;

/** Success and info notices go away on their own (they were already announced); problems stay until closed. */
const NOTICE_MS = 5000;

export default function AccountScreen() {
  const c = useColors();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const entitlements = useAppState((s) => s.entitlements);
  const syncing = useAppState((s) => s.entitlementsSyncing);
  const settings = useAppState((s) => s.settings);
  const downloaded = useAppState((s) => s.downloadedModels);
  const [busy, setBusy] = useState<Action | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (session) refreshEntitlementsIfStale(5_000);
    }, [session]),
  );

  useEffect(() => {
    if (!notice || notice.tone === 'danger' || notice.tone === 'warning') return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  function showError(place: Place, e: unknown) {
    const { message, action } = toAppError(e);
    // Empty for cancellations (closed prompt, dismissed sheet): nothing to show then.
    if (!message) return;
    const next = action && NOTICE_ACTIONS.includes(action) ? (action as NoticeAction) : undefined;
    setNotice({ place, tone: 'danger', message, action: next });
  }

  // Promise chain rather than try/finally, so the React Compiler can still optimise this screen.
  function run(kind: Action, place: Place, task: () => Promise<Outcome>) {
    if (busy) return;
    setBusy(kind);
    setNotice(null);
    task()
      .then((out) => {
        if (out) setNotice({ place: out.place ?? place, tone: out.tone, message: out.message, action: out.action });
      })
      .catch((e: unknown) => showError(place, e))
      .finally(() => setBusy(null));
  }

  const startPass = () =>
    run('pass', 'top', async () => {
      const res = await apiJson<{ entitlements: Entitlements }>('/v1/me/pass/activate', { method: 'POST' });
      setState({ entitlements: res.entitlements });
      // The card's pass banner is the visible result; it is silent, so it isn't re-read on every visit.
      const pass = res.entitlements.pass;
      if (pass) announce(t('passActiveUntil', { time: formatDate(pass.expiresAt, true) }));
    });

  const setAppLock = (on: boolean) =>
    run('lock', 'privacy', async () => {
      const available = await canUseBiometrics();
      if (on && !available) return { tone: 'warning', message: t('biometricsUnavailable') };
      // Turning the lock on proves unlocking works (and asks for Face ID permission now, not at the
      // first lock); turning it off proves it's the owner. With no biometrics left it just turns
      // off, so the owner is never stuck with a lock they can't open.
      if (available) {
        const res = await LocalAuthentication.authenticateAsync({ promptMessage: t('appLock'), cancelLabel: t('cancel') });
        if (!res.success) throw res;
      }
      updateSettings({ appLock: on });
      announce(t(on ? 'appLockOn' : 'appLockOff'));
    });

  const confirmClearHistory = () =>
    Alert.alert(t('clearHistory'), t('clearHistoryConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () =>
          run('history', 'privacy', async () => {
            await clearHistory();
            return { tone: 'success', message: t('historyCleared') };
          }),
      },
    ]);

  const restorePurchases = () =>
    run('restore', 'purchases', async () =>
      (await restore()) ? { tone: 'success', message: t('purchasesRestored') } : { tone: 'info', message: t('nothingToRestore') },
    );

  const manageSubscription = () =>
    run('manage', 'purchases', async () => {
      const url = await manageSubscriptionsUrl();
      if (!url) return { tone: 'info', message: t('manageInStore') };
      await Linking.openURL(url);
    });

  const exportData = () =>
    run('export', 'account', async () => {
      const res = await api('/v1/me/export');
      const file = new File(Paths.cache, 'my-translator-data.json');
      file.create({ overwrite: true });
      file.write(await res.text());
      // The share sheet is the result; closing it without sharing is not an error.
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: t('exportData') });
    });

  const signOut = () =>
    run('signout', 'account', async () => {
      const res = await authClient.signOut();
      if (res.error) throw res.error;
      // Cleared at once so a signed-out phone never shows the old plan, even offline.
      setState({ entitlements: null });
      void refreshEntitlements();
      return { tone: 'success', message: t('signedOut'), place: 'top' };
    });

  const confirmDeleteAccount = () =>
    Alert.alert(t('deleteAccount'), t('deleteAccountConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () =>
          run('delete', 'account', async () => {
            const res = await authClient.deleteUser();
            // The server only deletes from a session made in the last few minutes. An older one is
            // valid for everything else, so "your session has ended" would be confusing here.
            if (res.error && errorCode(res.error) === 'unauthorized') {
              return { tone: 'warning', message: t('deleteAccountReauth'), action: 'signIn' };
            }
            if (res.error) throw res.error;
            setState({ entitlements: null });
            await wipeLocalData();
            resetPreferences();
            return { tone: 'success', message: t('accountDeleted'), place: 'top' };
          }),
      },
    ]);

  const openLink = (url: string) => {
    WebBrowser.openBrowserAsync(url, { controlsColor: c.accent, toolbarColor: c.bg }).catch((e: unknown) => showError('privacy', e));
  };

  const follow = (action: NoticeAction) => {
    setNotice(null);
    if (action === 'signIn') router.push('/sign-in');
    else if (action === 'getCredits') router.push('/plans');
    else if (action === 'restorePurchases') restorePurchases();
    else Linking.openSettings().catch(() => {});
  };

  // A notice for a signed-in group that is gone (signed out, account deleted) moves to the top.
  const noticeAt = (place: Place) => {
    if (!notice) return null;
    const shown = !session && (notice.place === 'purchases' || notice.place === 'account') ? 'top' : notice.place;
    if (shown !== place) return null;
    const { action } = notice;
    return (
      <Banner
        key={place}
        tone={notice.tone}
        message={notice.message}
        action={action ? errorActionLabel(action) : undefined}
        onAction={action ? () => follow(action) : undefined}
        onDismiss={() => setNotice(null)}
      />
    );
  };

  const e = entitlements;
  const sub = e?.subscription;
  const balance = e?.balance ?? 0;
  const passes = e?.passesAvailable ?? 0;
  // The English pivot model is always installed and isn't a language the user downloaded.
  const offlineCount = Math.max(downloaded.length - 1, 0);
  const renewal = sub
    ? [sub.willRenew ? t('renewsOn', { date: formatDate(sub.expiresAt) }) : t('endsOn', { date: formatDate(sub.expiresAt) }), e?.tier === 'vip' ? t('vipResets') : null]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <Screen tab>
      <ScreenHeader title={t('tabAccount')} />

      {/* Nothing animates in on the first render; cards, groups and notices that appear later do. */}
      <LayoutAnimationConfig skipEntering>
        {session ? (
          <Card key="plan" entering={enterUp} layout={layoutTransition} style={styles.planCard}>
            <View style={styles.planTop}>
              <View style={styles.planText}>
                <Text variant="caption" tone="muted" language="en" flow="ui" numberOfLines={1} ellipsizeMode="middle">
                  {session.user.email}
                </Text>
                <Text variant="title">{t(TIER_LABEL[e?.tier ?? 'free'])}</Text>
              </View>
              <View accessible accessibilityLabel={tn('creditCount', balance)} style={[styles.balance, { backgroundColor: c.accentSoft }]}>
                <AnimatedNumber variant="title" tone="accent" value={balance} format={formatNumber} />
                <Text variant="eyebrow" tone="accent">
                  {t('credits')}
                </Text>
              </View>
            </View>

            {renewal ? (
              <Text variant="caption" tone="muted">
                {renewal}
              </Text>
            ) : null}
            {syncing ? (
              <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
                {t('updatingBalance')}
              </Text>
            ) : null}
            {e?.pass ? <Banner icon="timer" silent message={t('passActiveUntil', { time: formatDate(e.pass.expiresAt, true) })} /> : null}
            {passes > 0 && !e?.pass ? (
              <View style={styles.pass}>
                <Text variant="caption" tone="muted">
                  {tn('passesAvailable', passes)}
                </Text>
                <Button title={t('startPass')} icon="timer" kind="secondary" loading={busy === 'pass'} onPress={startPass} />
              </View>
            ) : null}
            <Button title={t('upgrade')} icon="sparkles" onPress={() => router.push('/plans')} />
          </Card>
        ) : sessionPending ? (
          <Card key="loading" style={styles.planCard}>
            <Skeleton lines={3} label={t('loading')} />
          </Card>
        ) : (
          <Card key="sign-in" entering={enterUp} layout={layoutTransition} style={styles.signInCard}>
            <EmptyState icon="account" title={t('signInTitle')} message={t('signInSubtitle')} style={styles.signInText} />
            <Button title={t('signIn')} onPress={() => router.push('/sign-in')} />
          </Card>
        )}
        {noticeAt('top')}

        <Group>
          <Section title={t('downloads')}>
            <Row icon="download" title={t('offlineLanguages')} detail={tn('downloadedCount', offlineCount)} onPress={() => router.push('/offline')} />
            <Row icon="wifi" title={t('wifiOnly')} value={settings.wifiOnlyDownloads} onValueChange={(v) => updateSettings({ wifiOnlyDownloads: v })} />
          </Section>
        </Group>

        <Group>
          <Section title={t('privacy')}>
            <Row icon="lock" title={t('appLock')} value={settings.appLock} loading={busy === 'lock'} onValueChange={setAppLock} />
            <Row icon="history" title={t('saveHistory')} value={settings.saveHistory} onValueChange={(v) => updateSettings({ saveHistory: v })} />
            <Row icon="trash" title={t('clearHistory')} loading={busy === 'history'} onPress={confirmClearHistory} />
            <Row icon="info" title={t('privacyPolicy')} onPress={() => openLink(PRIVACY_URL)} />
            <Row icon="file" title={t('terms')} onPress={() => openLink(TERMS_URL)} />
          </Section>
        </Group>
        {noticeAt('privacy')}

        {session ? (
          <Group key="purchases" entering={enterFade} exiting={exitFade}>
            <Section title={t('purchases')}>
              <Row icon="restore" title={t('restorePurchases')} loading={busy === 'restore'} onPress={restorePurchases} />
              {sub ? <Row icon="crown" title={t('manageSubscription')} loading={busy === 'manage'} onPress={manageSubscription} /> : null}
            </Section>
          </Group>
        ) : null}
        {noticeAt('purchases')}

        {session ? (
          // No title: the page is already "Account".
          <Group key="account" entering={enterFade} exiting={exitFade}>
            <Section>
              <Row icon="exportData" title={t('exportData')} loading={busy === 'export'} onPress={exportData} />
              <Row icon="logout" title={t('signOut')} loading={busy === 'signout'} onPress={signOut} />
              <Row icon="deleteAccount" title={t('deleteAccount')} destructive loading={busy === 'delete'} onPress={confirmDeleteAccount} />
            </Section>
          </Group>
        ) : null}
        {noticeAt('account')}

        <Group>
          <Text variant="caption" tone="muted" align="center">
            {t('version', { version: Constants.expoConfig?.version ?? '' })}
          </Text>
        </Group>
      </LayoutAnimationConfig>
    </Screen>
  );
}

/** A page block that glides when a notice or group above it appears or goes away. */
function Group(props: ComponentProps<typeof Animated.View>) {
  return <Animated.View layout={layoutTransition} {...props} />;
}

const styles = StyleSheet.create({
  planCard: { gap: space.md },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  planText: { flex: 1, minWidth: 0, gap: 2 },
  // Clips the rolling digits to the pill; the minimum width keeps it steady as the number changes.
  balance: {
    alignItems: 'center',
    minWidth: 88,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  pass: { gap: space.sm },
  signInCard: { gap: space.lg, paddingVertical: space.xl },
  // EmptyState's own page padding is replaced by the card's.
  signInText: { paddingVertical: 0, paddingHorizontal: 0 },
});
