import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { IconButton } from '@/components/Button';
import { displayName } from '@/components/LanguageBar';
import { Text } from '@/components/Text';
import { apiJson } from '@/lib/api';
import { cacheEntry, getCachedEntry } from '@/lib/db';
import { t, uiLanguage } from '@/lib/i18n';
import { speak } from '@/lib/speech';
import { getState } from '@/lib/store';
import { planRoute, translateText } from '@/lib/translator';
import { radius, space, useColors } from '@/theme';

interface Entry {
  senses: { partOfSpeech: string; definitions: { text: string; examples: string[] }[] }[];
  source: string;
}

export default function WordScreen() {
  const c = useColors();
  const { word, lang } = useLocalSearchParams<{ word: string; lang: string }>();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [cached, setCached] = useState(false);
  const [loading, setLoading] = useState(true);
  const [meaning, setMeaning] = useState<string | null>(null);

  // Translate the word back into the user's other language, preferring on-device.
  const s = getState();
  const into = lang === s.target ? (s.source === 'auto' ? uiLanguage : s.source) : s.target;

  useEffect(() => {
    let alive = true;
    (async () => {
      const local = await getCachedEntry<Entry>(word, lang, 'en').catch(() => null);
      if (local && alive) {
        setEntry(local);
        setCached(true);
      }
      try {
        const fresh = await apiJson<Entry>(`/v1/dictionary?word=${encodeURIComponent(word)}&lang=${encodeURIComponent(lang)}`);
        if (!alive) return;
        setEntry(fresh);
        if (fresh.senses.length) void cacheEntry(word, lang, 'en', fresh);
      } catch {
        // Offline: the cached entry (if any) stays on screen.
      } finally {
        if (alive) setLoading(false);
      }
    })();
    if (into !== lang && planRoute(lang, into, { signedIn: false, online: false }).kind === 'offline') {
      translateText(word, lang, into, { engine: 'offline', record: false })
        .then((r) => alive && setMeaning(r.text))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [word, lang, into]);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.body}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text variant="micro" tone="muted">
            {displayName(lang).toUpperCase()} · {t('dictionary').toUpperCase()}
          </Text>
          <Text variant="display" language={lang}>
            {word}
          </Text>
          {meaning && (
            <Text variant="title" tone="accent" language={into}>
              {meaning}
            </Text>
          )}
        </View>
        <IconButton icon="speaker" label={t('listen')} size={48} onPress={() => speak(word, lang)} />
      </View>

      {loading && !entry && <ActivityIndicator color={c.accent} />}
      {!loading && (!entry || entry.senses.length === 0) && (
        <Text variant="body" tone="muted">
          {t('noDefinitions')}
        </Text>
      )}

      {entry?.senses.map((sense, i) => (
        <View key={i} style={[styles.sense, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text variant="micro" tone="accent">
            {sense.partOfSpeech.toUpperCase()}
          </Text>
          {sense.definitions.map((d, j) => (
            <View key={j} style={styles.definition}>
              <Text variant="body">
                {j + 1}. {d.text}
              </Text>
              {d.examples.map((ex, k) => (
                <Text key={k} variant="caption" tone="muted" language={lang}>
                  “{ex}”
                </Text>
              ))}
            </View>
          ))}
        </View>
      ))}

      {entry && entry.senses.length > 0 && (
        <Text variant="caption" tone="faint">
          {entry.source}
          {cached ? ` · ${t('savedForOffline')}` : ''}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: space.xl, gap: space.lg, paddingBottom: space.xxxl },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  sense: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.md },
  definition: { gap: 4 },
});
