import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { displayName } from '@/components/LanguageBar';
import { Text } from '@/components/Text';
import { listHistory, type HistoryItem } from '@/lib/db';
import { formatDate, t } from '@/lib/i18n';
import { space, useColors } from '@/theme';

export default function HistoryScreen() {
  const c = useColors();
  const [items, setItems] = useState<HistoryItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      void listHistory(100).then(setItems).catch(() => setItems([]));
    }, []),
  );

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={(i) => String(i.id)}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Icon name="history" size={36} color={c.textFaint} />
          <Text variant="body" tone="muted" align="center">
            {t('saveHistory')}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/word', params: { word: item.output.split(/\s+/)[0] ?? item.output, lang: item.target } })}
          style={({ pressed }) => [styles.item, { borderBottomColor: c.border, backgroundColor: pressed ? c.surfaceAlt : 'transparent' }]}>
          <View style={styles.meta}>
            <Text variant="micro" tone="muted">
              {displayName(item.source)} → {displayName(item.target)}
            </Text>
            <Icon name={item.engine === 'offline' ? 'device' : 'cloud'} size={11} color={c.textFaint} />
            <View style={styles.flex} />
            <Text variant="micro" tone="faint">
              {formatDate(new Date(item.created_at).toISOString(), true)}
            </Text>
          </View>
          <Text variant="body" tone="muted" numberOfLines={2} language={item.source}>
            {item.input}
          </Text>
          <Text variant="heading" numberOfLines={3} language={item.target}>
            {item.output}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxxl },
  empty: { alignItems: 'center', gap: space.md, paddingTop: space.xxxl },
  item: { paddingVertical: space.md, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
