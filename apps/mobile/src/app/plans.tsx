import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, I18nManager, Linking, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { LayoutAnimationConfig, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { ALLOWANCES, CHARS_PER_CREDIT, PRODUCTS, isProductId, type Product, type ProductId } from '@translator/shared';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { ModalHeader } from '@/components/ModalHeader';
import { PressableScale, Skeleton, enterFade, enterPop, layoutTransition, spring, timing } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { announce } from '@/lib/a11y';
import { authClient } from '@/lib/auth';
import { PRIVACY_URL, TERMS_URL } from '@/lib/config';
import { errorActionLabel, toAppError, type AppError } from '@/lib/errors';
import { t, tn, type StringKey } from '@/lib/i18n';
import { useDismiss } from '@/lib/nav';
import { buy, getOffering, purchasesEnabled, restore } from '@/lib/purchases';
import { useAppState } from '@/lib/store';
import { iconSize, radius, space, tile, touch, useColors, useElevation, useIsDark } from '@/theme';

const TABS = ['subscriptions', 'pass', 'credits'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, StringKey> = { subscriptions: 'subscriptions', pass: 'sessionPass', credits: 'creditPacks' };
const TAB_PRODUCTS: Record<Tab, readonly ProductId[]> = {
  subscriptions: ['pro_weekly', 'pro_monthly', 'pro_yearly', 'vip_monthly', 'vip_yearly'],
  pass: ['pass_3h'],
  credits: ['credits_100', 'credits_500', 'credits_2000'],
};
const FEATURED: readonly ProductId[] = ['pro_yearly', 'credits_500'];
const PERIOD_LABEL: Record<'week' | 'month' | 'year', StringKey> = { week: 'weekly', month: 'monthly', year: 'yearly' };

/** How long the "bought" tick shows before the modal closes itself. */
const SUCCESS_HOLD_MS = 700;

type Packages = Partial<Record<ProductId, PurchasesPackage>>;
type Notice = { tone: 'success' | 'info'; message: string };
type Status = 'loading' | 'ready' | 'unavailable' | 'disabled' | 'buying' | 'bought';
type PlanItem = { id: ProductId; title: string; detail: string; icon: IconName };

function packagesOf(offering: PurchasesOffering | null): Packages {
  const map: Packages = {};
  for (const p of offering?.availablePackages ?? []) {
    // Google Play subscription ids look like "pro_monthly:monthly-base".
    const id = p.product.identifier.split(':')[0] ?? '';
    if (isProductId(id)) map[id] = p;
  }
  return map;
}

function describe(p: Product): PlanItem {
  switch (p.kind) {
    case 'subscription': {
      const vip = p.tier === 'vip';
      return {
        id: p.id,
        title: `${t(vip ? 'vipPlan' : 'proPlan')} · ${t(PERIOD_LABEL[p.period])}`,
        detail: vip
          ? t('vipFeatures', { credits: ALLOWANCES.vipWeeklyCredits })
          : t('proFeatures', { credits: ALLOWANCES.proDailyCredits }),
        icon: vip ? 'diamond' : 'crown',
      };
    }
    case 'credits':
      return {
        id: p.id,
        title: tn('creditCount', p.credits),
        detail: t('aboutChars', { chars: p.credits * CHARS_PER_CREDIT }),
        icon: 'bolt',
      };
    case 'pass':
      return { id: p.id, title: t('sessionPass'), detail: t('sessionPassHint'), icon: 'timer' };
  }
}

function notify(type: Haptics.NotificationFeedbackType) {
  Haptics.notificationAsync(type).catch(() => {});
}

function openLink(url: string) {
  WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => {}));
}

export default function PlansScreen() {
  const close = useDismiss();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const syncing = useAppState((s) => s.entitlementsSyncing);
  const [tab, setTab] = useState<Tab>('subscriptions');
  const [packages, setPackages] = useState<Packages>({});
  const [loading, setLoading] = useState(purchasesEnabled);
  const [busy, setBusy] = useState<ProductId | 'restore' | null>(null);
  const [bought, setBought] = useState<ProductId | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!purchasesEnabled) return;
    let live = true;
    getOffering()
      .then((offering) => {
        if (live) setPackages(packagesOf(offering));
      })
      .catch((e: unknown) => {
        const err = toAppError(e);
        if (live && err.message) setError(err);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  // Let the tick register, then close. useDismiss does nothing if the user already left.
  useEffect(() => {
    if (!bought) return;
    const timer = setTimeout(close, SUCCESS_HOLD_MS);
    return () => clearTimeout(timer);
  }, [bought, close]);

  const signedIn = !!session;
  // Not configured in this build, or the store returned no products (Expo Go, misconfiguration).
  const unavailable = !purchasesEnabled || (!loading && !error && Object.keys(packages).length === 0);
  const blockedHint = unavailable ? t('purchasesUnavailable') : !signedIn ? t('purchaseSignInRequired') : undefined;

  function fail(e: unknown) {
    const err = toAppError(e);
    if (!err.message) return; // Cancelled: nothing to say.
    setError(err);
    notify(Haptics.NotificationFeedbackType.Error);
  }

  // Promise chains rather than try/finally: the React Compiler skips components with `finally` blocks.
  function purchase(id: ProductId) {
    const pkg = packages[id];
    if (!pkg || busy !== null || bought !== null) return;
    setBusy(id);
    setError(null);
    setNotice(null);
    buy(pkg)
      .then((done) => {
        if (!done) return; // Cancelled in the store sheet.
        setBought(id);
        announce(t('purchaseComplete'));
        notify(Haptics.NotificationFeedbackType.Success);
      })
      .catch(fail)
      .finally(() => setBusy(null));
  }

  function restorePurchases() {
    if (busy !== null || bought !== null) return;
    setBusy('restore');
    setError(null);
    setNotice(null);
    restore()
      .then((found) =>
        setNotice(found ? { tone: 'success', message: t('purchasesRestored') } : { tone: 'info', message: t('nothingToRestore') }),
      )
      .catch(fail)
      .finally(() => setBusy(null));
  }

  function statusOf(id: ProductId): Status {
    if (bought === id) return 'bought';
    if (busy === id) return 'buying';
    if (loading) return 'loading';
    if (!packages[id] || !signedIn) return 'unavailable';
    if (busy !== null || bought !== null) return 'disabled';
    return 'ready';
  }

  const errorAction = error?.action === 'signIn' || error?.action === 'restorePurchases' ? error.action : undefined;
  const showSignIn = !sessionPending && !signedIn && !unavailable;
  const showSyncing = syncing && !bought;
  const hasBanners = showSignIn || unavailable || !!error || !!notice || showSyncing;

  return (
    <Screen edges={['top', 'bottom']} sheet>
      <ModalHeader />

      <View style={styles.hero}>
        <PlansIcon />
        <Text variant="display" align="center">
          {t('plansTitle')}
        </Text>
        <Text variant="body" tone="muted" align="center">
          {t('plansSubtitle')}
        </Text>
      </View>

      <Segmented value={tab} onChange={setTab} />

      {hasBanners ? (
        <View style={styles.banners}>
          {unavailable ? <Banner tone="warning" message={t('purchasesUnavailable')} /> : null}
          {showSignIn ? (
            <Banner icon="account" message={t('purchaseSignInRequired')} action={t('signIn')} onAction={() => router.push('/sign-in')} />
          ) : null}
          {error ? (
            <Banner
              tone="danger"
              message={error.message}
              action={errorAction ? errorActionLabel(errorAction) : undefined}
              onAction={errorAction === 'signIn' ? () => router.push('/sign-in') : errorAction ? restorePurchases : undefined}
              onDismiss={() => setError(null)}
            />
          ) : null}
          {notice ? <Banner tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} /> : null}
          {showSyncing ? <Banner icon="refresh" message={t('updatingBalance')} silent /> : null}
        </View>
      ) : null}

      {/* A tab switch fades the new options in; nothing animates when the modal first opens. */}
      <LayoutAnimationConfig skipEntering>
        <Animated.View key={tab} entering={enterFade} layout={layoutTransition} style={styles.options}>
          {TAB_PRODUCTS[tab].map((id) => {
            const item = describe(PRODUCTS[id]);
            const status = statusOf(id);
            return (
              <PlanOption
                key={id}
                {...item}
                price={packages[id]?.product.priceString ?? null}
                featured={FEATURED.includes(id)}
                status={status}
                hint={status === 'unavailable' ? blockedHint : undefined}
                onPress={() => purchase(id)}
              />
            );
          })}
        </Animated.View>
      </LayoutAnimationConfig>

      <Animated.View layout={layoutTransition} style={styles.footer}>
        <Button
          title={t('restorePurchases')}
          icon="restore"
          kind="ghost"
          loading={busy === 'restore'}
          disabled={!signedIn || unavailable || (busy !== null && busy !== 'restore') || bought !== null}
          accessibilityHint={blockedHint}
          onPress={restorePurchases}
        />
        {/* Store-required auto-renewal terms: muted, not faint, so they stay readable (WCAG AA). */}
        <Text variant="caption" tone="muted" align="center">
          {t('plansLegal', { pro: ALLOWANCES.proDailyCredits, vip: ALLOWANCES.vipWeeklyCredits })}
        </Text>
        <View style={styles.links}>
          <Button title={t('terms')} kind="ghost" size="compact" onPress={() => openLink(TERMS_URL)} />
          <Button title={t('privacyPolicy')} kind="ghost" size="compact" onPress={() => openLink(PRIVACY_URL)} />
        </View>
      </Animated.View>
    </Screen>
  );
}

function PlansIcon() {
  const c = useColors();
  return (
    <View style={[styles.heroTile, { backgroundColor: c.accentSoft }]}>
      <Icon name="sparkles" size={iconSize.xl} color={c.accent} />
    </View>
  );
}

/* ───────────────────────── Segmented control ───────────────────────── */

const TRACK_PAD = 4;

/** Three equal segments with a raised thumb that slides to the selected one (mirrored in RTL). */
function Segmented({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  const c = useColors();
  const lift = useElevation();
  const [width, setWidth] = useState(0);
  const segment = Math.max(width - TRACK_PAD * 2, 0) / TABS.length;
  // `start` is mirrored in right-to-left layouts but translateX is not, so the sign flips by hand.
  const x = TABS.indexOf(value) * segment * (I18nManager.isRTL ? -1 : 1);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: withSpring(x, spring.snappy) }] }));

  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: c.surfaceAlt }]}>
      {width > 0 ? <Animated.View style={[styles.thumb, { width: segment, backgroundColor: c.surfaceRaised }, lift, thumb]} /> : null}
      {TABS.map((key) => {
        const selected = key === value;
        return (
          <PressableScale
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            haptic={!selected}
            scaleTo={0.96}
            onPress={() => onChange(key)}
            style={styles.segment}>
            <Text variant="label" tone={selected ? 'default' : 'muted'} align="center" numberOfLines={2}>
              {t(TAB_LABEL[key])}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

/* ───────────────────────── Plan option ───────────────────────── */

// The option's accessibilityLabel already says the price (or "loading"); the skeleton and spinner
// would otherwise be a second TalkBack stop inside the card.
const HIDDEN = { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const;

function PlanOption({
  title,
  detail,
  icon,
  price,
  featured,
  status,
  hint,
  onPress,
}: Omit<PlanItem, 'id'> & {
  /** Store price string; null while loading or when the store has no such product. */
  price: string | null;
  featured: boolean;
  status: Status;
  /** Why the option can't be bought right now. */
  hint?: string;
  onPress: () => void;
}) {
  const c = useColors();
  const dark = useIsDark();
  const { fontScale } = useWindowDimensions();
  // Card is opaque, so the pressed wash is drawn over its content here rather than by PressableScale.
  const wash = useSharedValue(0);
  const washStyle = useAnimatedStyle(() => ({ opacity: wash.get() }));

  const dimmed = status === 'unavailable' || status === 'disabled';
  const selected = !dimmed && (featured || status === 'buying' || status === 'bought');
  // On the dark sheet a surface card would match the background, so live options step up a tone.
  const tone = dark && !dimmed ? 'alt' : 'surface';
  const border = selected ? 2 : StyleSheet.hairlineWidth;
  // At large text sizes the price moves under the description instead of squeezing it.
  const stacked = fontScale > 1.3;
  const priceLabel = status === 'loading' ? t('loading') : (price ?? t('priceUnavailable'));

  const priceSlot =
    status === 'loading' ? (
      <Skeleton lines={1} height={14} style={styles.priceSkeleton} />
    ) : status === 'buying' ? (
      <ActivityIndicator color={c.accent} />
    ) : status === 'bought' ? (
      <Animated.View entering={enterPop}>
        <Icon name="checkCircle" size={iconSize.lg} color={c.success} />
      </Animated.View>
    ) : price ? (
      <Text variant="heading" tone={dimmed ? 'muted' : 'default'} numberOfLines={1}>
        {price}
      </Text>
    ) : null;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${detail}, ${priceLabel}`}
      accessibilityHint={hint}
      accessibilityState={{ disabled: status !== 'ready', busy: status === 'buying' || status === 'loading' }}
      disabled={status !== 'ready'}
      scaleTo={0.98}
      onPressIn={() => wash.set(withTiming(1, timing.fast))}
      onPressOut={() => wash.set(withTiming(0, timing.base))}
      onPress={onPress}
      style={styles.optionPress}>
      <Card tone={tone} flat={dimmed} selected={selected} style={styles.option}>
        <View style={[styles.optionTile, { backgroundColor: dimmed ? c.surfaceAlt : c.accentSoft }]}>
          <Icon name={icon} size={iconSize.lg} color={dimmed ? c.textFaint : c.accent} />
        </View>
        <View style={styles.optionText}>
          <View style={styles.titleRow}>
            <Text variant="heading" tone={dimmed ? 'muted' : 'default'} style={styles.title}>
              {title}
            </Text>
            {featured ? (
              <View style={[styles.tag, { backgroundColor: dimmed ? c.surfaceAlt : c.accent }]}>
                <Text variant="micro" tone={dimmed ? 'muted' : 'onAccent'} caps numberOfLines={1}>
                  {t('bestValue')}
                </Text>
              </View>
            ) : null}
          </View>
          <Text variant="caption" tone="muted">
            {detail}
          </Text>
          {stacked && priceSlot ? (
            <View style={styles.priceStacked} {...HIDDEN}>
              {priceSlot}
            </View>
          ) : null}
        </View>
        {!stacked && priceSlot ? (
          <View style={styles.price} {...HIDDEN}>
            {priceSlot}
          </View>
        ) : null}
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.noTouch, { backgroundColor: c.pressed, borderRadius: radius.lg - border }, washStyle]}
        />
      </Card>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.sm, paddingBottom: space.sm },
  heroTile: { width: 72, height: 72, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  track: { flexDirection: 'row', borderRadius: radius.pill, padding: TRACK_PAD },
  thumb: { position: 'absolute', top: TRACK_PAD, bottom: TRACK_PAD, start: TRACK_PAD, borderRadius: radius.pill },
  segment: {
    flex: 1,
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  banners: { gap: space.sm },
  options: { gap: space.md },
  optionPress: { borderRadius: radius.lg },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  optionTile: { width: tile.size, height: tile.size, borderRadius: tile.radius, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, minWidth: 0, gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  title: { flexShrink: 1 },
  tag: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
  price: { flexShrink: 0, alignItems: 'flex-end', justifyContent: 'center', minWidth: iconSize.lg },
  priceStacked: { alignItems: 'flex-start', paddingTop: space.xs },
  priceSkeleton: { width: 56 },
  noTouch: { pointerEvents: 'none' },
  footer: { gap: space.sm, alignItems: 'stretch' },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm },
});
