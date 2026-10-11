import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import type { Entitlements } from '@translator/shared';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Row, Section } from '@/components/Row';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { api, apiJson } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { PRIVACY_URL, TERMS_URL } from '@/lib/config';
import { clearHistory, wipeLocalData } from '@/lib/db';
import { formatDate, t, type StringKey } from '@/lib/i18n';
import { manageSubscriptionsUrl, restore } from '@/lib/purchases';
import { setState, updateSettings, useAppState } from '@/lib/store';
import { refreshEntitlements } from '@/lib/translator';
import { radius, space, useColors } from '@/theme';

const TIER_LABEL: Record<Entitlements['tier'], StringKey> = {
  free: 'freePlan',
  credits: 'creditsPlan',
  pass: 'passPlan',
  pro: 'proPlan',
  vip: 'vipPlan',
};

export default function AccountScreen() {
  const c = useColors();
  const { data: session } = authClient.useSession();
  const entitlements = useAppState((s) => s.entitlements);
  const settings = useAppState((s) => s.settings);
  const downloaded = useAppState((s) => s.downloadedModels);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: string, fn: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setBusy(null);
    }
  }

  const startPass = () =>
    act('pass', async () => {
      const res = await apiJson<{ entitlements: Entitlements }>('/v1/me/pass/activate', { method: 'POST' });
      setState({ entitlements: res.entitlements });
    });

  const exportData = () =>
    act('export', async () => {
      const res = await api('/v1/me/export');
      const file = new File(Paths.cache, 'my-translator-data.json');
      file.create({ overwrite: true });
      file.write(await res.text());
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
    });

  const deleteAccount = () =>
    Alert.alert(t('deleteAccount'), t('deleteAccountConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () =>
          void act('delete', async () => {
            const res = await authClient.deleteUser();
            if (res.error) throw new Error(res.error.message ?? t('error'));
            await wipeLocalData();
            setState({ entitlements: null });
          }),
      },
    ]);

  const e = entitlements;
  const sub = e?.subscription;

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="display">{t('tabAccount')}</Text>
      </View>

      {error && <Banner icon="warning" tone="danger" message={error} />}

      {!session ? (
        <Card style={styles.signInCard}>
          <Icon name="account" size={40} color={c.accent} />
          <Text variant="title" align="center">
            {t('signInTitle')}
          </Text>
          <Text variant="body" tone="muted" align="center">
            {t('signInSubtitle')}
          </Text>
          <Button title={t('signIn')} onPress={() => router.push('/sign-in')} style={styles.full} />
        </Card>
      ) : (
        <Card style={styles.planCard}>
          <View style={styles.planTop}>
            <View style={styles.flex}>
              <Text variant="caption" tone="muted">
                {session.user.email}
              </Text>
              <Text variant="title">{t(TIER_LABEL[e?.tier ?? 'free'])}</Text>
            </View>
            <View style={[styles.balance, { backgroundColor: c.accentSoft }]}>
              <Text variant="title" tone="accent">
                {(e?.balance ?? 0).toLocaleString()}
              </Text>
              <Text variant="micro" tone="accent">
                {t('credits').toUpperCase()}
              </Text>
            </View>
          </View>

          {sub && (
            <Text variant="caption" tone="muted">
              {sub.willRenew ? t('renewsOn', { date: formatDate(sub.expiresAt) }) : t('endsOn', { date: formatDate(sub.expiresAt) })}
              {e?.tier === 'vip' ? ` · ${t('vipResets')}` : ''}
            </Text>
          )}
          {e?.pass && (
            <Banner icon="timer" message={t('passActiveUntil', { time: formatDate(e.pass.expiresAt, true) })} />
          )}
          {!!e?.passesAvailable && !e.pass && (
            <Button title={`${t('startPass')} · ${t('passesAvailable', { count: e.passesAvailable })}`} icon="timer" kind="secondary" loading={busy === 'pass'} onPress={() => void startPass()} />
          )}
          <Button title={t('upgrade')} icon="sparkles" onPress={() => router.push('/plans')} />
        </Card>
      )}

      <View style={styles.sections}>
        <Section title={t('offlineLanguages')}>
          <Row icon="download" title={t('offlineLanguages')} detail={`${Math.max(downloaded.length - 1, 0)} ${t('downloaded').toLowerCase()}`} onPress={() => router.push('/offline')} />
          <Row icon="wifi" title={t('wifiOnly')} value={settings.wifiOnlyDownloads} onValueChange={(v) => updateSettings({ wifiOnlyDownloads: v })} />
        </Section>

        <Section title={t('privacy')}>
          <Row icon="history" title={t('saveHistory')} value={settings.saveHistory} onValueChange={(v) => updateSettings({ saveHistory: v })} />
          <Row icon="trash" title={t('clearHistory')} onPress={() => void act('history', clearHistory)} />
          <Row icon="info" title={t('privacyPolicy')} onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)} />
          <Row icon="file" title={t('terms')} onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)} />
        </Section>

        {session && (
          <Section title={t('tabAccount')}>
            <Row icon="history" title={t('restorePurchases')} onPress={() => void act('restore', restore)} />
            {sub && (
              <Row
                icon="crown"
                title={t('manageSubscription')}
                onPress={() => void manageSubscriptionsUrl().then((url) => url && Linking.openURL(url))}
              />
            )}
            <Row icon="download" title={t('exportData')} onPress={() => void exportData()} />
            <Row icon="logout" title={t('signOut')} onPress={() => void act('signout', async () => { await authClient.signOut(); void refreshEntitlements(); })} />
            <Row icon="trash" title={t('deleteAccount')} destructive onPress={deleteAccount} />
          </Section>
        )}

        <Text variant="caption" tone="faint" align="center">
          {t('version', { version: Constants.expoConfig?.version ?? '' })}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: space.md, paddingBottom: space.lg },
  flex: { flex: 1 },
  full: { alignSelf: 'stretch' },
  signInCard: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
  planCard: { gap: space.md },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  balance: { alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.md },
  sections: { gap: space.xl, marginTop: space.xl },
});
