import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { ALLOWANCES, PRODUCTS, isProductId, type ProductId } from '@translator/shared';
import { Banner } from '@/components/Banner';
import { Button, IconButton } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { authClient } from '@/lib/auth';
import { PRIVACY_URL, TERMS_URL } from '@/lib/config';
import { dismiss } from '@/lib/nav';
import { t, type StringKey } from '@/lib/i18n';
import { buy, getOffering, purchasesEnabled, restore } from '@/lib/purchases';
import { radius, space, useColors } from '@/theme';

type Tab = 'subscriptions' | 'pass' | 'credits';

const PERIOD_LABEL: Record<string, StringKey> = { week: 'weekly', month: 'monthly', year: 'yearly' };

export default function PlansScreen() {
  const c = useColors();
  const { data: session } = authClient.useSession();
  const [tab, setTab] = useState<Tab>('subscriptions');
  const [packages, setPackages] = useState<Partial<Record<ProductId, PurchasesPackage>>>({});
  const [loading, setLoading] = useState(purchasesEnabled);
  const [busy, setBusy] = useState<ProductId | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!purchasesEnabled) return;
    getOffering()
      .then((offering) => {
        const map: Partial<Record<ProductId, PurchasesPackage>> = {};
        for (const p of offering?.availablePackages ?? []) {
          const id = p.product.identifier.split(':')[0]!;
          if (isProductId(id)) map[id] = p;
        }
        setPackages(map);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const subscriptions = useMemo(
    () => (['pro_weekly', 'pro_monthly', 'pro_yearly', 'vip_monthly', 'vip_yearly'] as const).map((id) => PRODUCTS[id]),
    [],
  );

  async function purchase(id: ProductId) {
    const pkg = packages[id];
    if (!pkg) return;
    setBusy(id);
    setError(null);
    try {
      if (await buy(pkg)) dismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setBusy(null);
    }
  }

  const option = (id: ProductId, title: string, detail: string, icon: IconName, highlight?: boolean) => {
    const pkg = packages[id];
    return (
      <Pressable
        key={id}
        accessibilityRole="button"
        disabled={!pkg || !session || busy !== null}
        onPress={() => void purchase(id)}
        style={({ pressed }) => [
          styles.option,
          { backgroundColor: c.surface, borderColor: highlight ? c.accent : c.border, opacity: pressed ? 0.85 : 1 },
          highlight && styles.highlight,
        ]}>
        <View style={[styles.optionIcon, { backgroundColor: c.accentSoft }]}>
          <Icon name={icon} size={20} color={c.accent} />
        </View>
        <View style={styles.flex}>
          <View style={styles.titleRow}>
            <Text variant="heading">{title}</Text>
            {highlight && (
              <View style={[styles.tag, { backgroundColor: c.accent }]}>
                <Text variant="micro" tone="onAccent">
                  {t('bestValue').toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <Text variant="caption" tone="muted">
            {detail}
          </Text>
        </View>
        <Text variant="heading" tone={pkg ? 'default' : 'faint'}>
          {busy === id ? '…' : (pkg?.product.priceString ?? '—')}
        </Text>
      </Pressable>
    );
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.close}>
        <IconButton icon="close" label={t('close')} onPress={() => dismiss()} />
      </View>
      <View style={styles.hero}>
        <Icon name="sparkles" size={36} color={c.accent} />
        <Text variant="display" align="center">
          {t('plansTitle')}
        </Text>
        <Text variant="body" tone="muted" align="center">
          {t('plansSubtitle')}
        </Text>
      </View>

      <View style={[styles.tabs, { backgroundColor: c.surfaceAlt }]} accessibilityRole="tablist">
        {(
          [
            ['subscriptions', t('plan')],
            ['pass', t('sessionPass')],
            ['credits', t('creditPacks')],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            onPress={() => setTab(key)}
            style={[styles.tab, tab === key && { backgroundColor: c.surface }]}>
            <Text variant="label" tone={tab === key ? 'default' : 'muted'}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {!session && <Banner icon="account" message={t('signInSubtitle')} action={t('signIn')} onAction={() => router.push('/sign-in')} />}
      {!purchasesEnabled && <Banner icon="info" tone="warning" message={t('purchasesUnavailable')} />}
      {error && <Banner icon="warning" tone="danger" message={error} />}

      <View style={styles.options}>
        {tab === 'subscriptions' &&
          subscriptions.map((p) =>
            p.kind === 'subscription'
              ? option(
                  p.id,
                  `${t(p.tier === 'vip' ? 'vipPlan' : 'proPlan')} · ${t(PERIOD_LABEL[p.period]!)}`,
                  p.tier === 'vip' ? t('vipFeatures') : t('proFeatures'),
                  p.tier === 'vip' ? 'diamond' : 'crown',
                  p.id === 'pro_yearly',
                )
              : null,
          )}
        {tab === 'pass' && option('pass_3h', t('sessionPass'), t('sessionPassHint'), 'timer', true)}
        {tab === 'credits' &&
          (['credits_100', 'credits_500', 'credits_2000'] as const).map((id) => {
            const p = PRODUCTS[id];
            return p.kind === 'credits'
              ? option(id, `${p.credits.toLocaleString()} ${t('credits')}`, t('aboutChars', { chars: (p.credits * 500).toLocaleString() }), 'bolt', id === 'credits_500')
              : null;
          })}
        {loading && (
          <Text variant="caption" tone="muted" align="center">
            …
          </Text>
        )}
      </View>

      <Button title={t('restorePurchases')} kind="ghost" loading={busy === 'restore'} onPress={() => void (setBusy('restore'), restore().finally(() => setBusy(null)))} />

      <Text variant="caption" tone="faint" align="center" style={styles.legal}>
        {t('plansLegal', { pro: ALLOWANCES.proDailyCredits, vip: ALLOWANCES.vipWeeklyCredits.toLocaleString() })}
      </Text>
      <View style={styles.links}>
        <Button title={t('terms')} kind="ghost" compact onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)} />
        <Button title={t('privacyPolicy')} kind="ghost" compact onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  close: { alignItems: 'flex-end', paddingTop: space.sm },
  hero: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  tabs: { flexDirection: 'row', borderRadius: radius.pill, padding: 4, marginVertical: space.lg },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.pill },
  options: { gap: space.md, marginBottom: space.lg },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1 },
  highlight: { borderWidth: 2 },
  optionIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  tag: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
  legal: { marginTop: space.md },
  links: { flexDirection: 'row', justifyContent: 'center' },
});
