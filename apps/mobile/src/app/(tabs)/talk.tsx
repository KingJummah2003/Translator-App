import { useNetworkState } from 'expo-network';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner } from '@/components/Banner';
import { IconButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { displayName } from '@/components/LanguageBar';
import { Text } from '@/components/Text';
import { ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { t, uiLanguage } from '@/lib/i18n';
import { speak, useDictation } from '@/lib/speech';
import { setLanguages, updateSettings, useAppState } from '@/lib/store';
import { downloadModels, planRoute, translateText } from '@/lib/translator';
import { radius, space, useColors } from '@/theme';

interface Message {
  id: number;
  from: 'me' | 'them';
  original: string;
  translated: string;
}

/**
 * Face-to-face conversation. The phone lies between two people: the top half is turned
 * around for the other person. Each side speaks in their own language; the translation
 * appears on the other side and is read aloud.
 */
export default function TalkScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const source = useAppState((s) => s.source);
  const target = useAppState((s) => s.target);
  const autoSpeak = useAppState((s) => s.settings.autoSpeak);
  useAppState((s) => s.downloadedModels);
  const { data: session } = authClient.useSession();
  const network = useNetworkState();
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);

  const mine = source === 'auto' ? uiLanguage : source;
  const theirs = target;
  const ctx = { signedIn: !!session, online: network.isInternetReachable !== false };
  const route = planRoute(mine, theirs, ctx);

  const dictation = useDictation((text, who) => void handleSpoken(text, who as 'me' | 'them'));

  async function handleSpoken(text: string, who: 'me' | 'them') {
    const from = who === 'me' ? mine : theirs;
    const to = who === 'me' ? theirs : mine;
    const r = planRoute(from, to, ctx);
    if (r.kind !== 'offline' && r.kind !== 'cloud') {
      setError(r.kind === 'download' ? t('downloadToUseOffline', { lang: r.missing.map(displayName).join(', ') }) : t('needsInternet', { lang: displayName(to) }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await translateText(text, from, to, { engine: r.kind });
      setMessages((m) => [...m, { id: nextId.current++, from: who, original: text, translated: result.text }]);
      if (autoSpeak) speak(result.text, to);
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'insufficient_credits' ? t('notEnoughCredits') : e instanceof Error ? e.message : t('error'));
    } finally {
      setBusy(false);
    }
  }

  const activeSide = useRef<'me' | 'them' | null>(null);
  const listening = (who: 'me' | 'them') => dictation.listening && activeSide.current === who;

  const panel = (who: 'me' | 'them') => {
    const lang = who === 'me' ? mine : theirs;
    const flipped = who === 'them';
    // Each side reads the whole conversation in its own language.
    const lines = messages.map((m) => ({ id: m.id, own: m.from === who, text: m.from === who ? m.original : m.translated }));
    const active = listening(who);
    return (
      <View style={[styles.panel, flipped && styles.flipped, { backgroundColor: flipped ? c.surfaceAlt : c.bg }]}>
        <View style={styles.panelHead}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/languages', params: { side: who === 'me' ? 'source' : 'target', allowAuto: '0' } })}
            style={[styles.langChip, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text variant="label">{displayName(lang)}</Text>
          </Pressable>
          {who === 'me' && (
            <IconButton icon="swap" label={t('swap')} onPress={() => setLanguages(theirs, mine)} />
          )}
          {who === 'me' && (
            <IconButton
              icon="speaker"
              label={t('autoSpeak')}
              active={autoSpeak}
              size={36}
              onPress={() => updateSettings({ autoSpeak: !autoSpeak })}
            />
          )}
        </View>
        <FlatList
          data={[...lines].reverse()}
          inverted
          keyExtractor={(l) => String(l.id)}
          contentContainerStyle={styles.lines}
          ListEmptyComponent={
            <Text variant="caption" tone="muted" align="center" style={styles.empty}>
              {who === 'me' ? t('talkHint') : ''}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onLongPress={() => speak(item.text, lang)}
              style={[
                styles.bubble,
                item.own ? styles.own : styles.other,
                { backgroundColor: item.own ? c.accent : c.surface, borderColor: c.border },
              ]}>
              <Text variant="body" tone={item.own ? 'onAccent' : 'default'} language={lang}>
                {item.text}
              </Text>
            </Pressable>
          )}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={active ? t('stop') : `${t('holdToTalk')} (${displayName(lang)})`}
          disabled={busy || (dictation.listening && !active)}
          onPress={() => {
            if (active) return dictation.stop();
            activeSide.current = who;
            void dictation.start(lang, who);
          }}
          style={[styles.mic, { backgroundColor: active ? c.danger : c.accent, opacity: busy ? 0.6 : 1 }]}>
          <Icon name={active ? 'stop' : 'mic'} size={26} color={c.onAccent} />
          <Text variant="label" tone="onAccent">
            {active ? (dictation.partial || t('listening')) : t('holdToTalk')}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.flex, { paddingTop: insets.top, backgroundColor: c.bg }]}>
      {panel('them')}
      <View style={[styles.divider, { backgroundColor: c.border }]} />
      {(error || route.kind === 'download' || route.kind === 'sign-in' || dictation.error === 'permission') && (
        <View style={styles.banner}>
          {dictation.error === 'permission' ? (
            <Banner icon="mic" tone="warning" message={t('micPermission')} />
          ) : error ? (
            <Banner icon="warning" tone="danger" message={error} />
          ) : route.kind === 'download' ? (
            <Banner
              icon="download"
              message={t('downloadToUseOffline', { lang: route.missing.map(displayName).join(', ') })}
              action={t('download')}
              onAction={() => void downloadModels(route.missing).catch((e: Error) => setError(e.message))}
            />
          ) : (
            <Banner icon="cloud" message={t('signInForCloud', { lang: displayName(theirs) })} action={t('signIn')} onAction={() => router.push('/sign-in')} />
          )}
        </View>
      )}
      {panel('me')}
      <View style={{ height: insets.bottom + 70 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  panel: { flex: 1, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm },
  flipped: { transform: [{ rotate: '180deg' }] },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  langChip: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  lines: { gap: space.sm, paddingVertical: space.sm, flexGrow: 1, justifyContent: 'flex-end' },
  empty: { paddingHorizontal: space.xl },
  bubble: { maxWidth: '85%', paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  own: { alignSelf: 'flex-end', borderBottomEndRadius: 6 },
  other: { alignSelf: 'flex-start', borderBottomStartRadius: 6 },
  mic: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: 56, borderRadius: radius.pill, paddingHorizontal: space.xl },
  divider: { height: StyleSheet.hairlineWidth },
  banner: { paddingHorizontal: space.lg, paddingVertical: space.sm },
});
