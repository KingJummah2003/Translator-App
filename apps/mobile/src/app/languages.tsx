import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Platform, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANGUAGES, getLanguage, type Language } from '@translator/shared';
import { IconButton } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon, type IconName } from '@/components/Icon';
import { ModalHeader } from '@/components/ModalHeader';
import { PressableScale, enterFade, listItem } from '@/components/motion';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { languageName, localeName, matchesSearch, normalizeSearch, regionName, sortByText, t, tn, type StringKey } from '@/lib/i18n';
import { dismiss } from '@/lib/nav';
import { speechDialects } from '@/lib/speech';
import { chooseLanguage, dialectFor, setDialect, useAppState } from '@/lib/store';
import { offlineCapable } from '@/lib/translator';
import { iconSize, radius, space, touch, useColors } from '@/theme';

type Status = 'downloaded' | 'available' | 'cloud';

interface Item {
  code: string;
  label: string;
  native: string;
  /** English and Arabic names: either one finds the language, whatever the interface language. */
  names: string[];
  /** Null for "Detect language". */
  status: Status | null;
}

interface LanguageSection {
  key: string;
  title: string;
  data: Item[];
  /** Rows above this section, so the entrance stagger runs on across section boundaries. */
  offset: number;
}

const STATUS: Record<Status, { icon: IconName; label: StringKey }> = {
  downloaded: { icon: 'downloaded', label: 'downloaded' },
  available: { icon: 'download', label: 'availableOffline' },
  cloud: { icon: 'cloud', label: 'cloudOnly' },
};

const HAIRLINE = StyleSheet.hairlineWidth;
const CHIP_HEIGHT = 36;

function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A name starts with the query, or one of its words does ("انجليزي" → "الإنجليزية"). */
function startsWithQuery(item: Item, q: string): boolean {
  if (item.code.toLowerCase() === q) return true;
  return [item.label, item.native, ...item.names].some((name) => {
    const n = normalizeSearch(name);
    return n.startsWith(q) || n.startsWith(`ال${q}`) || n.includes(` ${q}`) || n.includes(` ال${q}`);
  });
}

export default function LanguagesScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ side?: string; allowAuto?: string }>();
  // Anything but an explicit 'source' edits the target side (a malformed link must not guess).
  const side = param(params.side) === 'source' ? 'source' : 'target';
  const allowAuto = side === 'source' && param(params.allowAuto) !== '0';
  const current = useAppState((s) => (side === 'source' ? s.source : s.target));
  const recent = useAppState((s) => s.recent);
  const downloaded = useAppState((s) => s.downloadedModels);
  const [query, setQuery] = useState('');
  // The opening stagger plays once: rows that appear while searching show at once.
  const [searched, setSearched] = useState(false);

  const toItem = (l: Language): Item => ({
    code: l.code,
    label: languageName(l.code, l.name),
    native: l.native,
    names: [l.name, l.nameAr],
    status: downloaded.includes(l.code) ? 'downloaded' : offlineCapable(l.code) ? 'available' : 'cloud',
  });
  const all = sortByText(LANGUAGES.map(toItem), (i) => i.label);

  const q = query.trim();
  let sections: LanguageSection[];
  if (q) {
    const folded = normalizeSearch(q);
    const hits = all.filter((i) => i.code.toLowerCase() === folded || matchesSearch(q, i.label, i.native, ...i.names));
    // Names that start with the query first: "en" lists English before Armenian and Bengali.
    const ranked = [...hits.filter((i) => startsWithQuery(i, folded)), ...hits.filter((i) => !startsWithQuery(i, folded))];
    // Same key as the full list, so rows that stay visible while typing are not remounted.
    sections = ranked.length ? [{ key: 'all', title: tn('languageCount', ranked.length), data: ranked, offset: 0 }] : [];
  } else {
    const head: Item[] = allowAuto ? [{ code: 'auto', label: t('detect'), native: '', names: [], status: null }] : [];
    const recentItems = recent
      .map((code) => getLanguage(code))
      .filter((l): l is Language => !!l)
      .map(toItem);
    const top = [...head, ...recentItems];
    sections = [
      ...(top.length ? [{ key: 'recent', title: t('recent'), data: top, offset: 0 }] : []),
      { key: 'all', title: t('allLanguages'), data: all, offset: top.length },
    ];
  }

  function choose(code: string) {
    if (code !== current) chooseLanguage(side, code);
    // dismiss() goes home when the sheet was opened from a link with nothing behind it.
    dismiss();
  }

  const dialectCode = current !== 'auto' && getLanguage(current) ? current : null;
  const showClear = Platform.OS === 'android' && query.length > 0;

  return (
    <SafeAreaView edges={Platform.OS === 'android' ? ['top'] : []} style={[styles.flex, { backgroundColor: c.sheet }]}>
      <View style={styles.top}>
        <ModalHeader title={side === 'source' ? t('translateFrom') : t('translateTo')} sheet />
        <View>
          <TextField
            kind="search"
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setSearched(true);
            }}
            placeholder={t('search')}
            accessibilityLabel={t('search')}
            inputStyle={showClear ? styles.inputWithClear : undefined}
          />
          {/* iOS has the native clear button (clearButtonMode); Android has none. */}
          {showClear ? (
            <View style={styles.clear}>
              <IconButton icon="close" label={t('clear')} size={36} haptic={false} onPress={() => setQuery('')} />
            </View>
          ) : null}
        </View>
      </View>
      <SectionList<Item, LanguageSection>
        sections={sections}
        keyExtractor={(item) => item.code}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[styles.list, { paddingBottom: space.xl + (Platform.OS === 'android' ? insets.bottom : 0) }]}
        ListHeaderComponent={dialectCode ? <DialectPicker code={dialectCode} hidden={!!q} /> : null}
        ListEmptyComponent={
          q ? <EmptyState icon="search" title={t('noLanguagesFound', { query: q })} action={t('clear')} onAction={() => setQuery('')} /> : null
        }
        renderSectionHeader={({ section }) => (
          <Text variant="eyebrow" tone="muted" heading style={[styles.sectionTitle, section.key === sections[0]?.key && styles.firstSectionTitle]}>
            {section.title}
          </Text>
        )}
        renderItem={({ item, index, section }) => (
          <LanguageRow
            item={item}
            selected={item.code === current}
            first={index === 0}
            last={index === section.data.length - 1}
            entering={searched ? undefined : listItem(section.offset + index)}
            onPress={() => choose(item.code)}
          />
        )}
      />
    </SafeAreaView>
  );
}

function LanguageRow({
  item,
  selected,
  first,
  last,
  entering,
  onPress,
}: {
  item: Item;
  selected: boolean;
  first: boolean;
  last: boolean;
  entering: ComponentProps<typeof Animated.View>['entering'];
  onPress: () => void;
}) {
  const c = useColors();
  const status = item.status ? STATUS[item.status] : null;
  const showNative = !!item.native && item.native !== item.label;
  // Visible text first (voice control users say what they see), then the offline status.
  const label = [item.label, showNative ? item.native : null, status ? t(status.label) : null].filter(Boolean).join(', ');

  return (
    // The group shape lives on this wrapper, which also clips the pressed wash to the corners.
    <Animated.View
      entering={entering}
      style={[styles.group, { backgroundColor: c.surface, borderColor: c.border }, first && styles.groupFirst, last && styles.groupLast]}>
      <PressableScale
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={label}
        scaleTo={1}
        highlight={c.pressed}
        onPress={onPress}
        style={styles.row}>
        <View style={styles.texts}>
          <Text variant="body" style={selected && styles.selected}>
            {item.label}
          </Text>
          {showNative || status ? (
            <View style={styles.meta}>
              {showNative ? (
                <Text variant="caption" tone="muted" language={item.code} flow="ui">
                  {item.native}
                </Text>
              ) : null}
              {status ? (
                <View style={styles.status}>
                  <Icon name={status.icon} size={iconSize.xs} color={item.status === 'downloaded' ? c.success : c.textMuted} />
                  <Text variant="caption" tone={item.status === 'downloaded' ? 'success' : 'muted'}>
                    {t(status.label)}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        {selected ? <Icon name="check" size={iconSize.md} color={c.accent} /> : null}
      </PressableScale>
      {first ? null : <View style={[styles.separator, { backgroundColor: c.border }]} />}
    </Animated.View>
  );
}

// Dialect lists rarely change while the app runs: reopening the sheet shows them at once.
const dialectCache = new Map<string, string[]>();

/** "ar-EG" → "Egypt" (the language is in the heading); tags without a region keep their full name. */
function dialectLabel(tag: string): string {
  const region = tag
    .split(/[-_]/)
    .slice(1)
    .find((part) => /^([A-Za-z]{2}|\d{3})$/.test(part));
  return region ? regionName(region) : localeName(tag);
}

/**
 * Speech dialect for the selected language (recognition and read-aloud voice). Shown only when
 * the phone offers more than one. Stays mounted while searching so it doesn't reload.
 */
function DialectPicker({ code, hidden }: { code: string; hidden: boolean }) {
  const [loaded, setLoaded] = useState<{ code: string; tags: string[] } | null>(() => {
    const cached = dialectCache.get(code);
    return cached ? { code, tags: cached } : null;
  });
  const chosen = useAppState((s) => s.settings.dialects[code] ?? null);
  // The dialect chosen when the sheet opened goes first, so it is visible without scrolling;
  // the order then stays put while the user taps around.
  const [pinned] = useState(() => dialectFor(code));

  useEffect(() => {
    let alive = true;
    speechDialects(code)
      .then((tags) => {
        dialectCache.set(code, tags);
        if (alive) setLoaded({ code, tags });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [code]);

  const tags = loaded?.code === code ? loaded.tags : [];
  if (hidden || tags.length < 2) return null;

  const [standard, ...rest] = tags;
  const ordered = [standard, ...sortByText(rest, dialectLabel)].filter((tag): tag is string => !!tag);
  const options = pinned && ordered.includes(pinned) ? [pinned, ...ordered.filter((tag) => tag !== pinned)] : ordered;

  return (
    <Animated.View entering={enterFade} style={styles.dialect}>
      <Text variant="eyebrow" tone="muted" heading style={styles.sectionText}>
        {t('dialectFor', { lang: languageName(code) })}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroller}
        contentContainerStyle={styles.chips}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('dialect')}>
        <Chip label={t('automatic')} selected={!chosen} onPress={() => setDialect(code, null)} />
        {options.map((tag) => (
          <Chip key={tag} label={dialectLabel(tag)} selected={chosen === tag} onPress={() => setDialect(code, tag)} />
        ))}
      </ScrollView>
      <Text variant="caption" tone="muted" style={styles.sectionText}>
        {t('speechDialectHint')}
      </Text>
    </Animated.View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      hitSlop={(touch.min - CHIP_HEIGHT) / 2}
      highlight={c.pressed}
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? c.accent : c.borderStrong, backgroundColor: selected ? c.accentSoft : 'transparent' }]}>
      {selected ? <Icon name="check" size={iconSize.sm} color={c.accent} /> : null}
      <Text variant="label" tone={selected ? 'accent' : 'default'} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.md },
  inputWithClear: { paddingEnd: 40 },
  clear: { position: 'absolute', end: space.xs, top: 0, bottom: 0, justifyContent: 'center' },
  list: { paddingHorizontal: space.lg },
  sectionTitle: { paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.sm },
  firstSectionTitle: { paddingTop: space.md },
  sectionText: { paddingHorizontal: space.lg },
  // One card per section, drawn row by row so the list stays virtualized (same spec as Card).
  group: { borderLeftWidth: HAIRLINE, borderRightWidth: HAIRLINE, overflow: 'hidden' },
  groupFirst: { borderTopWidth: HAIRLINE, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  groupLast: { borderBottomWidth: HAIRLINE, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: 56 },
  separator: { position: 'absolute', top: 0, start: space.lg, end: 0, height: HAIRLINE },
  texts: { flex: 1, minWidth: 0, gap: 2 },
  selected: { fontWeight: '600' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md, rowGap: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dialect: { gap: space.sm, paddingTop: space.md, paddingBottom: space.md },
  // Chips scroll edge to edge of the sheet, past the list's side padding.
  chipScroller: { marginHorizontal: -space.lg },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: CHIP_HEIGHT,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
