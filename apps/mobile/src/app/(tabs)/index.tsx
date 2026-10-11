import * as Clipboard from 'expo-clipboard';
import { useNetworkState } from 'expo-network';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Share, StyleSheet, TextInput, View } from 'react-native';
import { isRtl } from '@translator/shared';
import { Banner } from '@/components/Banner';
import { Button, IconButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { LanguageBar, displayName } from '@/components/LanguageBar';
import { Screen } from '@/components/Screen';
import { Text, contentAlign } from '@/components/Text';
import { TappableText } from '@/components/TappableText';
import { ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { speak, stopSpeaking, useDictation } from '@/lib/speech';
import { useAppState } from '@/lib/store';
import {
  ModelMissingError,
  cloudCost,
  detectLanguage,
  downloadModels,
  planRoute,
  translateText,
  type TranslationResult,
} from '@/lib/translator';
import { radius, space, type as typeScale, useColors } from '@/theme';

const LIVE_DELAY_MS = 350;

export default function TranslateScreen() {
  const c = useColors();
  const source = useAppState((s) => s.source);
  const target = useAppState((s) => s.target);
  const downloading = useAppState((s) => s.downloading);
  useAppState((s) => s.downloadedModels); // re-plan when models change
  const { data: session } = authClient.useSession();
  const network = useNetworkState();
  const online = network.isInternetReachable !== false;

  const [text, setText] = useState('');
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const request = useRef(0);

  const route = planRoute(source === 'auto' && detected ? detected : source, target, { signedIn: !!session, online });
  const sourceForRun = source === 'auto' ? 'auto' : source;

  const dictation = useDictation((spoken) => setText((prev) => (prev ? `${prev} ${spoken}` : spoken)));

  async function run(engine: 'offline' | 'cloud') {
    const input = text.trim();
    if (!input) return;
    const id = ++request.current;
    if (engine === 'cloud') Keyboard.dismiss();
    setBusy(true);
    setError(null);
    try {
      const r = await translateText(input, sourceForRun, target, { engine });
      if (id !== request.current) return;
      setResult(r);
      if (r.detectedSource) setDetected(r.detectedSource);
    } catch (err) {
      if (id !== request.current) return;
      if (err instanceof ModelMissingError) setError(null);
      else if (err instanceof ApiError && err.code === 'insufficient_credits') setError(t('notEnoughCredits'));
      else setError(err instanceof Error ? err.message : t('error'));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }

  // Detect the language while typing (on-device, free).
  useEffect(() => {
    if (source !== 'auto' || text.trim().length < 3) return;
    const timer = setTimeout(() => void detectLanguage(text).then((d) => d && setDetected(d)), 250);
    return () => clearTimeout(timer);
  }, [text, source]);

  // Live translation, but only when it is on-device and therefore free.
  useEffect(() => {
    if (!text.trim()) {
      request.current++;
      setResult(null);
      setBusy(false);
      return;
    }
    if (route.kind !== 'offline') {
      // Cloud translations cost credits, so they only run when asked; drop the stale one.
      setResult((r) => (r?.engine === 'cloud' ? null : r));
      return;
    }
    const timer = setTimeout(() => void run('offline'), LIVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, source, target, route.kind]);

  const inputLang = source === 'auto' ? detected : source;
  const missingNames = route.kind === 'download' ? route.missing.map(displayName).join(', ') : '';
  const isDownloading = route.kind === 'download' && route.missing.some((m) => m in downloading);

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="display">{t('appName')}</Text>
        <IconButton icon="history" label={t('recent')} onPress={() => router.push('/history')} />
      </View>

      <LanguageBar detected={detected} />

      <Card style={styles.inputCard}>
        <TextInput
          value={dictation.listening && dictation.partial ? `${text}${text ? ' ' : ''}${dictation.partial}` : text}
          onChangeText={setText}
          placeholder={dictation.listening ? t('listening') : t('typeHere')}
          placeholderTextColor={c.textFaint}
          multiline
          maxLength={5000}
          autoCorrect
          textAlignVertical="top"
          accessibilityLabel={t('typeHere')}
          style={[
            styles.input,
            typeScale.input,
            { color: c.text },
            inputLang && { writingDirection: isRtl(inputLang) ? 'rtl' : 'ltr', textAlign: contentAlign(isRtl(inputLang)) },
          ]}
          returnKeyType="default"
        />
        <View style={styles.inputActions}>
          <IconButton
            icon={dictation.listening ? 'stop' : 'mic'}
            label={dictation.listening ? t('stop') : t('tapToSpeak')}
            active={dictation.listening}
            size={44}
            onPress={() => (dictation.listening ? dictation.stop() : void dictation.start(source))}
          />
          <View style={styles.flex} />
          {text.length > 0 && (
            <>
              <Text variant="caption" tone="faint">
                {text.length.toLocaleString()} / 5,000
              </Text>
              <IconButton icon="close" label={t('clear')} onPress={() => setText('')} />
            </>
          )}
        </View>
      </Card>

      {dictation.error === 'permission' && <Banner icon="mic" tone="warning" message={t('micPermission')} />}

      {text.trim().length > 0 && route.kind === 'download' && (
        <Banner
          icon="download"
          message={t('downloadToUseOffline', { lang: missingNames })}
          action={isDownloading ? t('downloading') : t('download')}
          loading={isDownloading}
          onAction={() => void downloadModels(route.missing).catch((e: Error) => setError(e.message))}
        />
      )}
      {text.trim().length > 0 && route.kind === 'sign-in' && (
        <Banner
          icon="cloud"
          message={t('signInForCloud', { lang: displayName(target) })}
          action={t('signIn')}
          onAction={() => router.push('/sign-in')}
        />
      )}
      {text.trim().length > 0 && route.kind === 'no-connection' && (
        <Banner icon="wifi" tone="warning" message={t('needsInternet', { lang: displayName(target) })} />
      )}

      {(route.kind === 'cloud' || (route.kind === 'download' && route.cloudPossible)) && text.trim().length > 0 && !result && (
        <Button
          title={`${t('translate')} · ${t('costCredits', { credits: cloudCost(text) })}`}
          icon="cloud"
          onPress={() => void run('cloud')}
          loading={busy}
        />
      )}

      {error && <Banner icon="warning" tone="danger" message={error} action={error === t('notEnoughCredits') ? t('getCredits') : undefined} onAction={() => router.push('/plans')} />}

      {result && (
        <Card tone="accent" style={styles.resultCard}>
          <View style={styles.resultHead}>
            <Text variant="micro" tone="accent">
              {displayName(target).toUpperCase()}
            </Text>
            <View style={[styles.badge, { backgroundColor: c.surface }]}>
              <Icon name={result.engine === 'offline' ? 'device' : 'cloud'} size={12} color={c.textMuted} />
              <Text variant="micro" tone="muted">
                {result.engine === 'offline' ? t('offlineBadge') : t('cloudBadge')}
              </Text>
            </View>
          </View>

          <TappableText
            text={result.text}
            lang={target}
            variant="result"
            onWord={(word) => router.push({ pathname: '/word', params: { word, lang: target } })}
          />
          {busy && (
            <Text variant="caption" tone="muted">
              {t('translating')}
            </Text>
          )}

          <View style={styles.resultActions}>
            <IconButton
              icon={speaking ? 'stop' : 'speaker'}
              label={speaking ? t('stop') : t('listen')}
              onPress={() => {
                if (speaking) return stopSpeaking();
                setSpeaking(true);
                speak(result.text, target, () => setSpeaking(false));
              }}
            />
            <IconButton
              icon={copied ? 'check' : 'copy'}
              label={copied ? t('copied') : t('copy')}
              onPress={() => {
                void Clipboard.setStringAsync(result.text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            />
            <IconButton icon="share" label={t('share')} onPress={() => void Share.share({ message: result.text })} />
            <View style={styles.flex} />
            {result.engine === 'offline' && session && online && (
              <Button title={t('betterQuality')} icon="sparkles" kind="ghost" compact onPress={() => void run('cloud')} />
            )}
          </View>
          <Text variant="caption" tone="faint">
            {t('tapWordHint')}
          </Text>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space.md, paddingBottom: space.lg },
  inputCard: { marginTop: space.lg, marginBottom: space.md, gap: space.sm, paddingBottom: space.sm },
  input: { minHeight: 120, maxHeight: 280, padding: 0 },
  inputActions: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  flex: { flex: 1 },
  resultCard: { marginTop: space.md, gap: space.md },
  resultHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill },
  resultActions: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginStart: -space.sm },
});
