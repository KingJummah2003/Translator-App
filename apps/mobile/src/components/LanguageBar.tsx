import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { getLanguage } from '@translator/shared';
import { languageName, t } from '@/lib/i18n';
import { swapLanguages, useAppState } from '@/lib/store';
import { radius, space, useColors } from '@/theme';
import { IconButton } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

export function displayName(code: string): string {
  if (code === 'auto') return t('detect');
  const l = getLanguage(code);
  return l ? languageName(code, l.name) : code;
}

/** Source ⇄ target selector shared by the translate, camera, talk and files screens. */
export function LanguageBar({ detected, allowAuto = true }: { detected?: string | null; allowAuto?: boolean }) {
  const c = useColors();
  const source = useAppState((s) => s.source);
  const target = useAppState((s) => s.target);
  const downloaded = useAppState((s) => s.downloadedModels);
  const shownSource = !allowAuto && source === 'auto' ? (detected ?? 'en') : source;

  const pill = (side: 'source' | 'target', code: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${side === 'source' ? t('translateFrom') : t('translateTo')}: ${displayName(code)}`}
      onPress={() => router.push({ pathname: '/languages', params: { side, allowAuto: allowAuto ? '1' : '0' } })}
      style={({ pressed }) => [styles.pill, { backgroundColor: pressed ? c.surfaceAlt : c.surface, borderColor: c.border }]}>
      <Text variant="label" numberOfLines={1} style={styles.pillText}>
        {code === 'auto' && detected ? `${displayName(detected)} ✦` : displayName(code)}
      </Text>
      {code !== 'auto' && downloaded.includes(code) && <Icon name="device" size={13} color={c.textFaint} />}
    </Pressable>
  );

  return (
    <View style={styles.bar}>
      {pill('source', shownSource)}
      <IconButton icon="swap" label={t('swap')} onPress={() => swapLanguages(detected)} disabled={source === 'auto' && !detected} />
      {pill('target', target)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  pill: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  pillText: { flexShrink: 1 },
});
