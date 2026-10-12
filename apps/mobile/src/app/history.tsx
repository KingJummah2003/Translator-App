import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner } from '@/components/Banner';
import { IconButton } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { displayName } from '@/components/LanguageBar';
import { PressableScale, Skeleton, exitFade, listItem, reorder } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { announce } from '@/lib/a11y';
import { deleteHistoryItem, listHistory, wasDatabaseReset, type HistoryItem } from '@/lib/db';
import { formatDate, t } from '@/lib/i18n';
import { dismiss } from '@/lib/nav';
import { useAppState } from '@/lib/store';
import { iconSize, radius, space, useColors, useElevation } from '@/theme';

const LIMIT = 200;
/** Long enough to read in a confirmation, short enough to fit it. */
const PREVIEW_CHARS = 80;

/** "English › Arabic" for the eye; screen readers get the whole row as one sentence. */
function pairLabel(item: HistoryItem): string {
  return item.source === 'auto' ? displayName(item.target) : t('languagePair', { from: displayName(item.source), to: displayName(item.target) });
}

function preview(text: string): string {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…` : text;
}

export default function HistoryScreen() {
  const c = useColors();
  const lift = useElevation();
  const { bottom } = useSafeAreaInsets();
  const saveHistory = useAppState((s) => s.settings.saveHistory);
  // null while the first load runs.
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [resetNoticeOpen, setResetNoticeOpen] = useState(wasDatabaseReset);

  const load = useCallback(() => {
    let live = true;
    listHistory(LIMIT).then(
      (list) => {
        if (!live) return;
        setItems(list);
        setFailed(false);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  // Reloads every time the screen comes back into view (a translation may have been added).
  useFocusEffect(load);

  function retry() {
    setFailed(false);
    load();
  }

  /** Back on the Translate tab with this translation filled in (its id only, never the text). */
  function open(item: HistoryItem) {
    router.dismissTo({ pathname: '/', params: { restore: String(item.id) } });
  }

  function remove(item: HistoryItem) {
    setItems((list) => list?.filter((i) => i.id !== item.id) ?? list);
    deleteHistoryItem(item.id).then(
      () => announce(t('historyItemDeleted')),
      () => load(), // put it back as it really is
    );
  }

  function confirmRemove(item: HistoryItem) {
    Alert.alert(t('deleteTranslation'), preview(item.input), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => remove(item) },
    ]);
  }

  const loading = items === null && !failed;
  const historyOffNotice = !saveHistory && !!items?.length;
  const notices =
    resetNoticeOpen || historyOffNotice ? (
      <View style={styles.notices}>
        {resetNoticeOpen && <Banner message={t('historyReset')} onDismiss={() => setResetNoticeOpen(false)} />}
        {historyOffNotice && <Banner tone="warning" message={t('historyOff')} silent />}
      </View>
    ) : null;

  return (
    <Screen scroll={false} padded={false} gap={0} contentStyle={styles.page}>
      {/* The page draws its own header, like every other page; the system back gesture still works. */}
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <ScreenHeader title={t('history')} leading={<IconButton icon="back" label={t('back')} onPress={dismiss} />} />
      </View>

      <Animated.FlatList
        data={items ?? []}
        keyExtractor={(i) => String(i.id)}
        itemLayoutAnimation={reorder}
        contentContainerStyle={[styles.list, { paddingBottom: bottom + space.xl }]}
        ListHeaderComponent={notices}
        ListEmptyComponent={
          loading ? (
            <Skeleton lines={3} label={t('loading')} style={styles.loading} />
          ) : failed ? (
            <EmptyState icon="error" tone="danger" title={t('historyLoadFailed')} action={t('retry')} actionIcon="refresh" onAction={retry} />
          ) : (
            <EmptyState icon="history" title={t('historyEmpty')} message={saveHistory ? t('historyEmptyHint') : t('historyOff')} />
          )
        }
        renderItem={({ item, index }) => {
          const engine = item.engine === 'offline' ? t('offlineBadge') : t('cloudBadge');
          const date = formatDate(item.created_at, true);
          return (
            // The first rows rise in one after another; PressableScale owns its own transform.
            <Animated.View entering={listItem(index)} exiting={exitFade}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`${pairLabel(item)}, ${engine}, ${item.input}, ${item.output}, ${date}`}
                accessibilityHint={t('historyOpenHint')}
                accessibilityActions={[{ name: 'delete', label: t('delete') }]}
                onAccessibilityAction={(e: AccessibilityActionEvent) => {
                  if (e.nativeEvent.actionName === 'delete') confirmRemove(item);
                }}
                onPress={() => open(item)}
                onLongPress={() => confirmRemove(item)}
                scaleTo={0.98}
                highlight={c.pressed}
                style={[styles.item, { backgroundColor: c.surface, borderColor: c.border }, lift]}>
                <View style={styles.meta}>
                  <View style={styles.pair}>
                    {item.source !== 'auto' && (
                      <>
                        <Text variant="label" tone="muted">
                          {displayName(item.source)}
                        </Text>
                        {/* Points the reading direction's way: Icon mirrors it in right-to-left layouts. */}
                        <Icon name="chevron" size={iconSize.xs} color={c.textFaint} />
                      </>
                    )}
                    <Text variant="label" tone="muted">
                      {displayName(item.target)}
                    </Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: c.surfaceAlt }]}>
                    <Icon name={item.engine === 'offline' ? 'device' : 'cloud'} size={iconSize.xs} color={c.textMuted} />
                    <Text variant="micro" tone="muted" numberOfLines={1}>
                      {engine}
                    </Text>
                  </View>
                  <Text variant="caption" tone="muted" style={styles.date}>
                    {date}
                  </Text>
                </View>
                <Text variant="body" tone="muted" numberOfLines={2} language={item.source === 'auto' ? null : item.source}>
                  {item.input}
                </Text>
                <Text variant="heading" numberOfLines={3} language={item.target}>
                  {item.output}
                </Text>
              </PressableScale>
            </Animated.View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The list runs under the home indicator and pads its own end instead.
  page: { paddingBottom: 0 },
  header: { paddingHorizontal: space.lg, paddingBottom: space.lg },
  list: { flexGrow: 1, paddingHorizontal: space.lg, gap: space.sm },
  notices: { gap: space.sm, paddingBottom: space.xs },
  loading: { paddingTop: space.sm },
  item: {
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Wraps at large text sizes instead of clipping the date.
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.sm, rowGap: space.xs },
  pair: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs, flexShrink: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
  date: { marginStart: 'auto' },
});
