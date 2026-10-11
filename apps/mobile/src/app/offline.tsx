import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { LANGUAGES } from '@translator/shared';
import { translationAvailable } from 'translator-native';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { languageName, t } from '@/lib/i18n';
import { updateSettings, useAppState } from '@/lib/store';
import { deleteModel, downloadModels } from '@/lib/translator';
import { space, useColors } from '@/theme';
import { Row } from '@/components/Row';

export default function OfflineLanguagesScreen() {
  const c = useColors();
  const downloaded = useAppState((s) => s.downloadedModels);
  const downloading = useAppState((s) => s.downloading);
  const wifiOnly = useAppState((s) => s.settings.wifiOnlyDownloads);
  const [error, setError] = useState<string | null>(null);

  const languages = useMemo(
    () =>
      LANGUAGES.filter((l) => l.offline)
        .map((l) => ({ ...l, label: languageName(l.code, l.name) }))
        .sort((a, b) => Number(downloaded.includes(b.code)) - Number(downloaded.includes(a.code)) || a.label.localeCompare(b.label)),
    [downloaded],
  );

  const run = (fn: () => Promise<void>) => {
    setError(null);
    fn().catch((e: Error) => setError(e.message));
  };

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={styles.list}
      contentInsetAdjustmentBehavior="automatic"
      data={languages}
      keyExtractor={(l) => l.code}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text variant="body" tone="muted">
            {t('offlineLanguagesHint')}
          </Text>
          {!translationAvailable && <Banner icon="info" tone="warning" message="On-device translation needs a development build on a real device." />}
          {error && <Banner icon="warning" tone="danger" message={error} />}
          <View style={[styles.group, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Row icon="wifi" title={t('wifiOnly')} value={wifiOnly} onValueChange={(v) => updateSettings({ wifiOnlyDownloads: v })} />
          </View>
        </View>
      }
      renderItem={({ item }) => {
        const have = downloaded.includes(item.code);
        const progress = downloading[item.code];
        return (
          <View style={[styles.row, { borderBottomColor: c.border }]}>
            <View style={styles.flex}>
              <Text variant="body">{item.label}</Text>
              <Text variant="caption" tone="muted" language={item.code}>
                {item.native}
              </Text>
            </View>
            {progress !== undefined ? (
              <View style={styles.progress}>
                <ActivityIndicator color={c.accent} />
                {progress > 0 && <Text variant="caption" tone="muted">{Math.round(progress * 100)}%</Text>}
              </View>
            ) : have ? (
              item.code === 'en' ? (
                <Text variant="caption" tone="success">
                  {t('downloaded')}
                </Text>
              ) : (
                <Button title={t('delete')} kind="ghost" compact onPress={() => run(() => deleteModel(item.code))} />
              )
            ) : (
              <Button title={t('download')} kind="secondary" compact icon="download" disabled={!translationAvailable} onPress={() => run(() => downloadModels([item.code]))} />
            )}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxxl },
  header: { gap: space.md, paddingVertical: space.lg },
  group: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
