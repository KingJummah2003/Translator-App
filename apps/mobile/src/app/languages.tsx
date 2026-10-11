import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { LANGUAGES, getLanguage, type Language } from '@translator/shared';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { languageName, t } from '@/lib/i18n';
import { getState, setLanguages, useAppState } from '@/lib/store';
import { offlineCapable } from '@/lib/translator';
import { radius, space, useColors } from '@/theme';

interface Item {
  code: string;
  label: string;
  native: string;
  offline: 'downloaded' | 'available' | 'cloud';
}

export default function LanguagesScreen() {
  const c = useColors();
  const { side, allowAuto } = useLocalSearchParams<{ side: 'source' | 'target'; allowAuto?: string }>();
  const current = useAppState((s) => (side === 'source' ? s.source : s.target));
  const recent = useAppState((s) => s.recent);
  const downloaded = useAppState((s) => s.downloadedModels);
  const [query, setQuery] = useState('');

  const toItem = (l: Language): Item => ({
    code: l.code,
    label: languageName(l.code, l.name),
    native: l.native,
    offline: downloaded.includes(l.code) ? 'downloaded' : offlineCapable(l.code) ? 'available' : 'cloud',
  });

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = LANGUAGES.map(toItem).sort((a, b) => a.label.localeCompare(b.label));
    if (q) {
      const hits = all.filter(
        (i) => i.label.toLowerCase().includes(q) || i.native.toLowerCase().includes(q) || i.code.toLowerCase() === q,
      );
      return [{ title: t('allLanguages'), data: hits }];
    }
    const head: Item[] = side === 'source' && allowAuto !== '0' ? [{ code: 'auto', label: t('detect'), native: '', offline: 'downloaded' }] : [];
    const recentItems = recent.map((code) => getLanguage(code)).filter((l): l is Language => !!l).map(toItem);
    return [
      ...(head.length || recentItems.length ? [{ title: t('recent'), data: [...head, ...recentItems] }] : []),
      { title: t('allLanguages'), data: all },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, recent, downloaded, side, allowAuto]);

  function choose(code: string) {
    const s = getState();
    if (side === 'source') {
      setLanguages(code, code === s.target ? (s.source === 'auto' ? 'en' : s.source) : s.target);
    } else {
      setLanguages(code === s.source ? s.target : s.source, code);
    }
    router.back();
  }

  return (
    <View style={[styles.flex, { backgroundColor: c.bg }]}>
      <View style={styles.top}>
        <Text variant="title">{side === 'source' ? t('translateFrom') : t('translateTo')}</Text>
        <View style={[styles.search, { backgroundColor: c.surfaceAlt }]}>
          <Icon name="search" size={16} color={c.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('search')}
            placeholderTextColor={c.textFaint}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            style={[styles.searchInput, { color: c.text }]}
            accessibilityLabel={t('search')}
          />
        </View>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(item, i) => `${item.code}-${i}`}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => (
          <Text variant="micro" tone="muted" style={styles.sectionHeader}>
            {section.title.toUpperCase()}
          </Text>
        )}
        renderItem={({ item }) => {
          const selected = item.code === current;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => choose(item.code)}
              style={({ pressed }) => [styles.row, { backgroundColor: selected ? c.accentSoft : pressed ? c.surfaceAlt : 'transparent' }]}>
              <View style={styles.flex}>
                <Text variant="body" style={selected && { fontWeight: '600' }}>
                  {item.label}
                </Text>
                {item.native && item.native !== item.label ? (
                  <Text variant="caption" tone="muted" language={item.code}>
                    {item.native}
                  </Text>
                ) : null}
              </View>
              {item.code !== 'auto' && (
                <Icon
                  name={item.offline === 'downloaded' ? 'downloaded' : item.offline === 'available' ? 'download' : 'cloud'}
                  size={16}
                  color={item.offline === 'downloaded' ? c.success : c.textFaint}
                />
              )}
              {selected && <Icon name="check" size={16} color={c.accent} />}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { padding: space.lg, paddingTop: space.xl, gap: space.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, height: 44 },
  searchInput: { flex: 1, fontSize: 16 },
  list: { paddingHorizontal: space.sm, paddingBottom: space.xxxl },
  sectionHeader: { paddingHorizontal: space.md, paddingTop: space.lg, paddingBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md, borderRadius: radius.md },
});
