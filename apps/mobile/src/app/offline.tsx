import { Stack, router } from 'expo-router';
import { NetworkStateType, useNetworkState } from 'expo-network';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANGUAGES } from '@translator/shared';
import { translationAvailable } from 'translator-native';
import { Banner } from '@/components/Banner';
import { IconButton } from '@/components/Button';
import { ProgressBar, listItem, reorder } from '@/components/motion';
import { Row, Section } from '@/components/Row';
import { Screen } from '@/components/Screen';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { announce } from '@/lib/a11y';
import { errorMessage } from '@/lib/errors';
import { formatPercent, languageName, sortByText, t, type StringKey } from '@/lib/i18n';
import { updateSettings, useAppState } from '@/lib/store';
import { deleteModel, downloadModels, offlineQuality, type OfflineQuality } from '@/lib/translator';
import { radius, space, useColors } from '@/theme';

/** English is the pivot every on-device translation goes through, so it can't be removed. */
const PIVOT = 'en';
const HAIRLINE = StyleSheet.hairlineWidth;

interface Lang {
  code: string;
  label: string;
  native: string;
}

type LanguageEntry = Lang & {
  kind: 'language';
  key: string;
  have: boolean;
  first: boolean;
  last: boolean;
  /** 0-1 while downloading. */
  progress: number | undefined;
  /** Tapped, waiting for the download to start or the delete to finish. */
  pending: boolean;
};

type Entry = { kind: 'header'; key: string; title: string } | LanguageEntry;

type Pending = Record<string, 'download' | 'delete'>;

const QUALITY: Record<OfflineQuality, StringKey> = { good: 'qualityGood', fair: 'qualityFair', basic: 'qualityBasic' };

// Names don't change while the app runs, so the alphabetical order is worked out once.
const OFFLINE_LANGUAGES: Lang[] = sortByText(
  LANGUAGES.filter((l) => l.offline).map((l) => ({ code: l.code, label: languageName(l.code, l.name), native: l.native })),
  (l) => l.label,
);

function without(pending: Pending, code: string): Pending {
  const next = { ...pending };
  delete next[code];
  return next;
}

/** Back to the previous screen, or to Account when this page was opened from a link. */
function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/account');
}

export default function OfflineLanguagesScreen() {
  const insets = useSafeAreaInsets();
  const network = useNetworkState();
  const downloaded = useAppState((s) => s.downloadedModels);
  const downloading = useAppState((s) => s.downloading);
  const wifiOnly = useAppState((s) => s.settings.wifiOnlyDownloads);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Pending>({});

  // ML Kit holds Wi-Fi-only downloads while the phone is on mobile data.
  const waitingForWifi = wifiOnly && network.type === NetworkStateType.CELLULAR;

  const group = (key: string, title: string, list: Lang[], have: boolean): Entry[] =>
    list.length
      ? [
          { kind: 'header', key: `section-${key}`, title },
          ...list.map(
            (l, i): Entry => ({
              ...l,
              kind: 'language',
              // The language code: a row keeps its identity when it moves between the groups.
              key: l.code,
              have,
              first: i === 0,
              last: i === list.length - 1,
              progress: downloading[l.code],
              pending: pending[l.code] === (have ? 'delete' : 'download'),
            }),
          ),
        ]
      : [];

  const mine = OFFLINE_LANGUAGES.filter((l) => downloaded.includes(l.code)).sort((a, b) => Number(b.code === PIVOT) - Number(a.code === PIVOT));
  const rest = OFFLINE_LANGUAGES.filter((l) => !downloaded.includes(l.code));
  const data = [...group('downloaded', t('downloaded'), mine, true), ...group('available', t('availableToDownload'), rest, false)];

  function download(lang: Lang) {
    setError('');
    setPending((p) => ({ ...p, [lang.code]: 'download' }));
    downloadModels([lang.code])
      .then(() => announce(t('languageDownloaded', { lang: lang.label })))
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setPending((p) => without(p, lang.code)));
  }

  function remove(lang: Lang) {
    setError('');
    setPending((p) => ({ ...p, [lang.code]: 'delete' }));
    deleteModel(lang.code)
      .then(() => announce(t('languageDeleted', { lang: lang.label })))
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setPending((p) => without(p, lang.code)));
  }

  function confirmRemove(lang: Lang) {
    Alert.alert(t('deleteLanguage', { lang: lang.label }), t('deleteLanguageConfirm', { lang: lang.label }), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => remove(lang) },
    ]);
  }

  return (
    // Not scrolling: the list below is virtualized and brings its own bottom inset.
    <Screen scroll={false} padded={false} gap={0} contentStyle={styles.noPadding}>
      {/* The page draws its own header (same as the tab pages) instead of the native one. */}
      <Stack.Screen options={{ headerShown: false }} />
      <Animated.FlatList
        data={data}
        keyExtractor={(entry) => entry.key}
        // Rows glide to their new place when a download finishes or a language is deleted.
        itemLayoutAnimation={reorder}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + space.xl }]}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader title={t('offlineLanguages')} leading={<IconButton icon="back" label={t('back')} onPress={goBack} />} />
            <Text variant="body" tone="muted">
              {t('offlineLanguagesHint')}
            </Text>
            {translationAvailable ? null : <Banner tone="warning" message={t('onDeviceNeedsDevBuild')} silent />}
            <Section>
              <Row icon="wifi" title={t('wifiOnly')} value={wifiOnly} onValueChange={(v) => updateSettings({ wifiOnlyDownloads: v })} />
            </Section>
          </View>
        }
        renderItem={({ item, index }) =>
          item.kind === 'header' ? (
            <Animated.View entering={listItem(index)}>
              <Text variant="eyebrow" tone="muted" heading style={styles.groupTitle}>
                {item.title}
              </Text>
            </Animated.View>
          ) : (
            <OfflineRow
              item={item}
              waitingForWifi={waitingForWifi}
              entering={listItem(index)}
              onDownload={() => download(item)}
              onDelete={() => confirmRemove(item)}
            />
          )
        }
      />
      {/* Errors sit below the list, so they are seen wherever the row that failed was scrolled. */}
      {error ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
          <Banner tone="danger" message={error} onDismiss={() => setError('')} />
        </View>
      ) : null}
    </Screen>
  );
}

function OfflineRow({
  item,
  waitingForWifi,
  entering,
  onDownload,
  onDelete,
}: {
  item: LanguageEntry;
  waitingForWifi: boolean;
  entering: ComponentProps<typeof Animated.View>['entering'];
  onDownload: () => void;
  onDelete: () => void;
}) {
  const c = useColors();
  const downloading = item.progress !== undefined;
  const waiting = downloading && waitingForWifi && (item.progress ?? 0) < 1;
  const pivot = item.code === PIVOT && item.have;
  const showNative = item.native !== item.label;
  const note = downloading
    ? waiting
      ? t('waitingForWifi')
      : t('downloading')
    : pivot
      ? t('englishRequired')
      : t('offlineQuality', { quality: t(QUALITY[offlineQuality(item.code)]) });
  const status = downloading ? null : item.have ? t('downloaded') : t('availableToDownload');

  let trailing: ReactNode = null;
  if (downloading) {
    // ML Kit on Android only reports 0 and 1, so 0 shows an indeterminate sweep.
    const progress = item.progress ?? 0;
    trailing = (
      <View style={styles.progress}>
        <ProgressBar progress={progress > 0 ? progress : null} label={t('downloadingLanguage', { lang: item.label })} style={styles.progressBar} />
        {progress > 0 ? (
          <Text variant="caption" tone="muted" style={styles.percent} importantForAccessibility="no" accessibilityElementsHidden>
            {formatPercent(progress)}
          </Text>
        ) : null}
      </View>
    );
  } else if (item.have) {
    trailing = pivot ? null : (
      <IconButton icon="trash" tint={c.danger} label={t('deleteLanguage', { lang: item.label })} loading={item.pending} onPress={onDelete} />
    );
  } else {
    trailing = (
      <IconButton
        icon="download"
        variant="tonal"
        tint={c.accent}
        label={t('downloadLanguage', { lang: item.label })}
        accessibilityHint={translationAvailable ? undefined : t('onDeviceNeedsDevBuild')}
        disabled={!translationAvailable}
        loading={item.pending}
        onPress={onDownload}
      />
    );
  }

  return (
    <Animated.View
      entering={entering}
      style={[styles.groupRow, { backgroundColor: c.surface, borderColor: c.border }, item.first && styles.groupFirst, item.last && styles.groupLast]}>
      <View style={styles.row}>
        {/* One screen-reader stop for the language and its state; the button is the next stop. */}
        <View
          style={styles.texts}
          accessible
          accessibilityLabel={[item.label, showNative ? item.native : null, status, note].filter(Boolean).join(', ')}>
          <Text variant="body">{item.label}</Text>
          <View style={styles.meta}>
            {showNative ? (
              <Text variant="caption" tone="muted" language={item.code} flow="ui">
                {item.native}
              </Text>
            ) : null}
            <Text variant="caption" tone={waiting ? 'warning' : 'muted'}>
              {note}
            </Text>
          </View>
        </View>
        {trailing}
      </View>
      {item.first ? null : <View style={[styles.separator, { backgroundColor: c.border }]} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  noPadding: { paddingBottom: 0 },
  list: { paddingHorizontal: space.lg },
  header: { gap: space.lg, paddingBottom: space.sm },
  groupTitle: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  // One card per group, drawn row by row so the list stays virtualized (same spec as Card).
  groupRow: { borderLeftWidth: HAIRLINE, borderRightWidth: HAIRLINE, overflow: 'hidden' },
  groupFirst: { borderTopWidth: HAIRLINE, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  groupLast: { borderBottomWidth: HAIRLINE, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingStart: space.lg, paddingEnd: space.sm, paddingVertical: space.sm, minHeight: 64 },
  separator: { position: 'absolute', top: 0, start: space.lg, end: 0, height: HAIRLINE },
  texts: { flex: 1, minWidth: 0, gap: 2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md, rowGap: 2 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingEnd: space.sm },
  progressBar: { width: 64 },
  percent: { minWidth: 36, textAlign: 'right', fontVariant: ['tabular-nums'] },
  footer: { paddingHorizontal: space.lg, paddingTop: space.sm },
});
