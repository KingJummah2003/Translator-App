import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'expo-image';
import { useNetworkState } from 'expo-network';
import { router, useFocusEffect, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, Platform, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COSTS, getLanguage } from '@translator/shared';
import { TranslatorNative, textRecognitionAvailable } from 'translator-native';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { LanguageBar, displayName } from '@/components/LanguageBar';
import { PressableScale, Skeleton, enterDelayed, enterFade, enterUp, exitFade, layoutTransition, useReducedMotion } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TappableText } from '@/components/TappableText';
import { Text, contentAlign } from '@/components/Text';
import { announce } from '@/lib/a11y';
import { authClient } from '@/lib/auth';
import { errorActionLabel, toAppError, type ErrorAction } from '@/lib/errors';
import { formatList, t } from '@/lib/i18n';
import { useAppState } from '@/lib/store';
import {
  cloudCost,
  cloudOcr,
  detectLanguage,
  downloadModels,
  offlineCapable,
  planRoute,
  recordHistory,
  translateText,
  type Engine,
} from '@/lib/translator';
import { MAX_WIDTH, iconSize, radius, space, useColors, useTabBarInset } from '@/theme';

interface Translation {
  text: string;
  /** The languages it was made for ('auto' when the cloud could not tell). */
  source: string;
  target: string;
  engine: Engine;
}

interface Result {
  /** The text read from the photo. */
  text: string;
  /** Its language when read: the chosen source or the detected one; null when unknown. */
  sourceLang: string | null;
  translation: Translation | null;
  /** Who read the photo: the phone, or the cloud ("Better quality"). */
  reader: Engine;
}

/** reading: first read of a photo; translating: text read, translation running; cloud: "Better quality". */
type Busy = 'reading' | 'translating' | 'cloud' | null;

interface Problem {
  message: string;
  tone: 'danger' | 'warning' | 'info';
  action?: ErrorAction;
  languages?: string[];
  /** The language pair it was about; hidden once the user picks other languages. */
  pair?: string;
}

/** Whether the phone itself can read text written in this language. */
function onDeviceOcr(source: string): boolean {
  if (!textRecognitionAvailable) return false;
  if (Platform.OS === 'ios') {
    if (source === 'auto') return true;
    const supported = TranslatorNative.supportedRecognitionLanguages();
    return supported.some((l) => l === source || l.startsWith(`${source}-`));
  }
  return source === 'auto' || getLanguage(source)?.ocr !== undefined;
}

const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/** For text in an unknown language: right-to-left when its first letter is, like a paragraph. */
function startsRtl(text: string): boolean {
  const first = /\p{L}/u.exec(text)?.[0];
  return !!first && RTL_LETTER.test(first);
}

export default function CameraScreen() {
  const c = useColors();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const source = useAppState((s) => s.source);
  const target = useAppState((s) => s.target);
  const downloading = useAppState((s) => s.downloading);
  useAppState((s) => s.downloadedModels); // re-plan when models change
  const { data: session } = authClient.useSession();
  const network = useNetworkState();
  const online = network.isInternetReachable !== false;

  const [photo, setPhoto] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  // Every photo (and Retake) starts a new run; answers that arrive for an older run are dropped.
  const run = useRef(0);
  const pair = `${source}>${target}`;
  // A language the user picks wins over detection, e.g. to correct a wrong guess after the photo.
  const textLanguage = (r: Result) => (source === 'auto' ? r.sourceLang : source);

  // The permission hook reads the status once; re-read it when the user comes back from Settings.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') getPermission().catch(() => {});
    });
    return () => sub.remove();
  }, [getPermission]);

  // Android back goes from a photo back to the viewfinder instead of leaving the app.
  useFocusEffect(
    useCallback(() => {
      if (!photo) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        run.current++;
        setPhoto(null);
        setResult(null);
        setProblem(null);
        setBusy(null);
        return true;
      });
      return () => sub.remove();
    }, [photo]),
  );

  function reset() {
    run.current++;
    setPhoto(null);
    setResult(null);
    setProblem(null);
    setBusy(null);
  }

  function fail(e: unknown, forPair?: string) {
    const err = toAppError(e);
    // Cancellations have no message: show nothing.
    setProblem(err.message ? { message: err.message, tone: 'danger', action: err.action, languages: err.languages, pair: forPair } : null);
  }

  /** Translates the text read from the photo. The text stays on screen when this fails. */
  async function translateRead(read: Result, engine: Engine, id: number) {
    const from = textLanguage(read) ?? 'auto';
    setBusy('translating');
    try {
      const r = await translateText(read.text, from, target, { engine });
      if (id !== run.current) return;
      const detected = from === 'auto' ? r.detectedSource : null;
      setResult({
        ...read,
        sourceLang: read.sourceLang ?? detected,
        translation: { text: r.text, source: detected ?? from, target, engine: r.engine },
      });
      announce(t('translationReady'));
    } catch (e) {
      if (id === run.current) fail(e, pair);
    } finally {
      if (id === run.current) setBusy(null);
    }
  }

  /** Reads a photo on the phone when it can (free, private), else in the cloud; `cloud` is "Better quality". */
  async function readPhoto(uri: string, reader: Engine = 'offline') {
    const id = ++run.current;
    const better = reader === 'cloud';
    setPhoto(uri);
    setProblem(null);
    // "Better quality" keeps the current result on screen until the new one arrives.
    if (!better) setResult(null);
    setBusy(better ? 'cloud' : 'reading');
    announce(t('readingText'));
    try {
      if (!better && onDeviceOcr(source)) {
        const recognized = await TranslatorNative.recognizeText(uri, source === 'auto' ? [] : [source]);
        if (id !== run.current) return;
        const text = recognized.text.trim();
        if (text) {
          const sourceLang = source === 'auto' ? await detectLanguage(text) : source;
          if (id !== run.current) return;
          const read: Result = { text, sourceLang, translation: null, reader: 'offline' };
          setResult(read);
          const from = sourceLang ?? source;
          if (from === target) return;
          const route = planRoute(from, target, { signedIn: !!session, online });
          // On the phone the language must be known; otherwise the screen asks for it.
          if (route.kind === 'cloud' || (route.kind === 'offline' && from !== 'auto')) await translateRead(read, route.kind, id);
          return;
        }
        if (!session) {
          setProblem({ message: t('noTextFound'), tone: 'warning' });
          return;
        }
      }
      if (!session) {
        setProblem({
          message: t('signInForCloud', { lang: displayName(source === 'auto' ? target : source) }),
          tone: 'info',
          action: 'signIn',
          pair,
        });
        return;
      }
      // Cloud OCR: shrink the photo first (faster, cheaper, less data leaves the phone).
      const image = await ImageManipulator.manipulate(uri).resize({ width: 1600 }).renderAsync();
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
      const res = await cloudOcr(saved.base64 ?? '', target);
      if (id !== run.current) return;
      const text = res.text.trim();
      if (!text) {
        setProblem({ message: t('noTextFound'), tone: 'warning' });
        return;
      }
      const sourceLang = res.detectedSource ?? (source === 'auto' ? null : source);
      const translation: Translation | null = res.translation
        ? { text: res.translation, source: sourceLang ?? 'auto', target, engine: 'cloud' }
        : null;
      setResult({ text, sourceLang, translation, reader: 'cloud' });
      if (translation) {
        announce(t('translationReady'));
        if (sourceLang) {
          const entry = { input: text, text: translation.text, engine: 'cloud' as const, detectedSource: sourceLang, charged: res.charged, source, target };
          void recordHistory(entry, { revise: false });
        }
      }
    } catch (e) {
      if (id === run.current) fail(e, pair);
    } finally {
      if (id === run.current) setBusy(null);
    }
  }

  async function pick() {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['image/*'], copyToCacheDirectory: true });
      const uri = res.canceled ? undefined : res.assets[0]?.uri;
      if (uri) void readPhoto(uri);
    } catch (e) {
      fail(e);
    }
  }

  function download(languages: string[]) {
    const id = run.current;
    const read = result;
    setProblem(null);
    downloadModels(languages)
      .then(() => {
        if (id === run.current && read && textLanguage(read)) return translateRead(read, 'offline', id);
      })
      .catch((e: unknown) => {
        if (id === run.current) fail(e, pair);
      });
  }

  function chooseSource() {
    router.push({ pathname: '/languages', params: { side: 'source', allowAuto: '0' } });
  }

  function act(p: Problem) {
    switch (p.action) {
      case 'getCredits':
      case 'restorePurchases':
        return router.push('/plans');
      case 'signIn':
        return router.push('/sign-in');
      case 'chooseLanguage':
        return chooseSource();
      case 'openSettings':
        return void Linking.openSettings().catch(() => {});
      case 'download':
        return download(p.languages ?? []);
    }
  }

  // A problem about another language pair, or a sign-in prompt the user has since acted on, is stale.
  const stale = !!problem && ((!!problem.pair && problem.pair !== pair) || (problem.tone === 'info' && problem.action === 'signIn' && !!session));
  const shown = problem && !stale ? problem : null;
  const banner = shown ? (
    <Banner
      tone={shown.tone}
      message={shown.message}
      action={shown.action ? errorActionLabel(shown.action) : undefined}
      onAction={shown.action ? () => act(shown) : undefined}
      loading={shown.action === 'download' && !!shown.languages?.some((l) => l in downloading)}
      onDismiss={() => setProblem(null)}
    />
  ) : null;

  if (!permission) {
    // Usually instant; the spinner only shows if the permission check is slow.
    return (
      <View style={[styles.flex, styles.center, { backgroundColor: c.bg }]}>
        <Animated.View entering={enterDelayed}>
          <ActivityIndicator color={c.accent} accessibilityLabel={t('loading')} />
        </Animated.View>
      </View>
    );
  }

  if (!photo && !permission.granted) {
    return (
      <Screen tab>
        <ScreenHeader title={t('tabCamera')} subtitle={t('cameraHint')} />
        <LanguageBar />
        <View style={styles.permission}>
          <EmptyState icon="camera" title={t('cameraTitle')} message={t('cameraPermission')} />
          <View style={styles.permissionActions}>
            <Button
              title={permission.canAskAgain ? t('allow') : t('openSettings')}
              onPress={() => {
                const ask = permission.canAskAgain ? requestPermission() : Linking.openSettings();
                ask.catch(() => {});
              }}
            />
            <Button title={t('pickPhoto')} kind="ghost" icon="photo" onPress={() => void pick()} />
          </View>
        </View>
        {banner}
      </Screen>
    );
  }

  if (!photo) {
    return <Viewfinder onPhoto={(uri) => void readPhoto(uri)} onPick={() => void pick()} onProblem={setProblem} banner={banner} />;
  }

  const textLang = result ? textLanguage(result) : null;
  const from = textLang ?? 'auto';
  // A translation is current while the user keeps its target (and its source, if they chose one).
  const translation =
    result?.translation && result.translation.target === target && (source === 'auto' || result.translation.source === source)
      ? result.translation
      : null;
  // What it takes to translate text that has no (current) translation yet.
  const route = result && !translation && busy === null && from !== target ? planRoute(from, target, { signedIn: !!session, online }) : null;
  const cloudPossible =
    route?.kind === 'cloud' ||
    (route?.kind === 'download' && route.cloudPossible) ||
    (route?.kind === 'offline' && from === 'auto' && !!session && online);
  // The language that needs the cloud: the target unless only the source lacks an offline model.
  const cloudLang = offlineCapable(target) ? from : target;
  const missing = route?.kind === 'download' ? route.missing : [];
  const betterQuality = !!result && !!session && online && result.reader === 'offline' && result.translation?.engine !== 'cloud' && busy !== 'reading';
  const credits = COSTS.ocrImage();

  return (
    <Screen tab>
      <ScreenHeader title={t('tabCamera')} />
      <LanguageBar detected={source === 'auto' ? (result?.sourceLang ?? null) : null} />
      <Animated.View entering={enterFade} style={[styles.photo, { backgroundColor: c.surfaceAlt }]}>
        <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" />
      </Animated.View>

      {banner}

      {busy === 'reading' && (
        <Card key="reading" tone="accent" entering={enterUp} exiting={exitFade} layout={layoutTransition} style={styles.card}>
          <Text variant="eyebrow" tone="accent">
            {t('readingText')}
          </Text>
          <Skeleton lines={3} label={t('readingText')} />
        </Card>
      )}

      {busy === 'translating' ? (
        <Card key="translating" tone="accent" entering={enterUp} exiting={exitFade} layout={layoutTransition} style={styles.card}>
          <Text variant="eyebrow" tone="accent">
            {`${t('translation')} · ${displayName(target)}`}
          </Text>
          <Skeleton lines={2} label={t('translating')} />
        </Card>
      ) : translation ? (
        <Card key="translation" tone="accent" entering={enterUp} exiting={exitFade} layout={layoutTransition} style={styles.card}>
          <View style={styles.cardHead}>
            <Text variant="eyebrow" tone="accent" style={styles.shrink}>
              {`${t('translation')} · ${displayName(translation.target)}`}
            </Text>
            <EngineBadge engine={translation.engine} />
          </View>
          <TappableText
            text={translation.text}
            lang={translation.target}
            variant="heading"
            onWord={(word) => router.push({ pathname: '/word', params: { word, lang: translation.target } })}
          />
          <Text variant="caption" tone="muted">
            {t('tapWordHint')}
          </Text>
        </Card>
      ) : null}

      {route && shown?.action !== 'download' && (
        <>
          {route.kind === 'offline' && from === 'auto' && (
            <Banner icon="globe" message={t('detectFailed')} action={t('chooseLanguage')} onAction={chooseSource} />
          )}
          {route.kind === 'offline' && from !== 'auto' && result && (
            <Appear>
              <Button title={t('translate')} icon="translate" onPress={() => void translateRead(result, 'offline', run.current)} />
            </Appear>
          )}
          {route.kind === 'download' && (
            <Banner
              icon="download"
              message={t('downloadToUseOffline', { lang: formatList(missing.map(displayName)) })}
              action={missing.some((m) => m in downloading) ? t('downloading') : t('download')}
              loading={missing.some((m) => m in downloading)}
              onAction={() => download(missing)}
            />
          )}
          {route.kind === 'sign-in' && (
            <Banner icon="cloud" message={t('signInForCloud', { lang: displayName(cloudLang) })} action={t('signIn')} onAction={() => router.push('/sign-in')} />
          )}
          {route.kind === 'no-connection' && <Banner icon="wifi" tone="warning" message={t('needsInternet', { lang: displayName(cloudLang) })} />}
          {cloudPossible && result && (
            <Appear>
              <Button
                title={`${t('translate')} · ${t('costCredits', { credits: cloudCost(result.text) })}`}
                icon="cloud"
                kind={route.kind === 'cloud' ? 'primary' : 'secondary'}
                onPress={() => void translateRead(result, 'cloud', run.current)}
              />
            </Appear>
          )}
        </>
      )}

      {result && (
        <Card key="original" entering={enterUp} exiting={exitFade} layout={layoutTransition} style={styles.card}>
          <Text variant="eyebrow" tone="muted">
            {textLang ? `${t('original')} · ${displayName(textLang)}` : t('original')}
          </Text>
          <OriginalText text={result.text} language={textLang} />
        </Card>
      )}

      {!result && busy === null && shown?.tone !== 'warning' && (
        <Appear>
          <Button title={t('retry')} icon="refresh" onPress={() => void readPhoto(photo)} />
        </Appear>
      )}

      {betterQuality && (
        <Appear>
          <Button
            title={`${t('betterQuality')} · ${t('costCredits', { credits })}`}
            accessibilityHint={t('betterQualityHint', { credits })}
            icon="sparkles"
            kind="ghost"
            loading={busy === 'cloud'}
            disabled={busy === 'translating'}
            onPress={() => void readPhoto(photo, 'cloud')}
          />
        </Appear>
      )}

      <Appear>
        <Button title={t('retake')} icon="camera" kind="secondary" onPress={reset} />
      </Appear>
    </Screen>
  );
}

/** Live preview with the language bar on top and the shutter at the bottom, above the tab bar. */
function Viewfinder({
  onPhoto,
  onPick,
  onProblem,
  banner,
}: {
  onPhoto: (uri: string) => void;
  onPick: () => void;
  onProblem: (problem: Problem) => void;
  banner: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const bottom = useTabBarInset();
  const focused = useIsFocused();
  const reduced = useReducedMotion();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  // State updates are async, so a quick double tap would otherwise take two pictures.
  const capturingNow = useRef(false);

  // The preview unmounts while another tab (or a sheet) is showing and must report ready again.
  useFocusEffect(useCallback(() => () => setReady(false), []));

  async function capture() {
    if (capturingNow.current || !ready) return;
    capturingNow.current = true;
    setCapturing(true);
    try {
      const pic = await camera.current?.takePictureAsync({ quality: 0.85, shutterSound: false });
      if (pic?.uri) onPhoto(pic.uri);
    } catch {
      onProblem({ message: t('captureFailed'), tone: 'danger' });
    } finally {
      capturingNow.current = false;
      setCapturing(false);
    }
  }

  return (
    <View style={[styles.flex, { backgroundColor: c.bg }]}>
      {/* Light status bar text over the camera feed; restores the app's style when this unmounts. */}
      {focused && <StatusBar style="light" />}
      {focused && (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          animateShutter={!reduced}
          onCameraReady={() => setReady(true)}
          onMountError={() => onProblem({ message: t('cameraUnavailable'), tone: 'danger' })}
        />
      )}
      <View style={[styles.overlayTop, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.column}>
          <LanguageBar />
          <View style={[styles.hint, { backgroundColor: c.mediaScrim }]}>
            <Text variant="caption" align="center" style={{ color: c.onMedia }}>
              {t('cameraHint')}
            </Text>
          </View>
          {banner}
        </View>
      </View>
      <View style={[styles.controls, { paddingBottom: bottom }]}>
        <View style={[styles.column, styles.controlsRow]}>
          <View style={styles.side}>
            <Button title={t('pickPhoto')} kind="secondary" icon="photo" compact onPress={onPick} />
          </View>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('capture')}
            accessibilityState={{ disabled: !ready, busy: capturing }}
            disabled={!ready || capturing}
            scaleTo={0.92}
            onPress={() => void capture()}
            style={[styles.shutter, { borderColor: c.onMedia, opacity: ready ? 1 : 0.5 }]}>
            {capturing ? (
              <ActivityIndicator color={c.onMedia} />
            ) : (
              <View style={[styles.shutterDisc, { backgroundColor: c.onMedia }]} />
            )}
          </PressableScale>
          <View style={styles.side} />
        </View>
      </View>
    </View>
  );
}

/** Recognised text, laid out in its own direction (also when its language is unknown). */
function OriginalText({ text, language }: { text: string; language: string | null }) {
  const rtl = !language && startsRtl(text);
  return (
    <Text variant="body" language={language} selectable align={rtl ? contentAlign(true) : undefined} style={rtl ? styles.rtl : undefined}>
      {text}
    </Text>
  );
}

function EngineBadge({ engine }: { engine: Engine }) {
  const c = useColors();
  return (
    <View style={[styles.badge, { backgroundColor: c.surface }]}>
      <Icon name={engine === 'offline' ? 'device' : 'cloud'} size={iconSize.xs} color={c.textMuted} />
      <Text variant="micro" tone="muted">
        {engine === 'offline' ? t('offlineBadge') : t('cloudBadge')}
      </Text>
    </View>
  );
}

/** Buttons fade in and glide when cards above them appear (PressableScale owns its transform). */
function Appear({ children }: { children: ReactNode }) {
  return (
    <Animated.View entering={enterFade} exiting={exitFade} layout={layoutTransition}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  shrink: { flexShrink: 1 },
  rtl: { writingDirection: 'rtl' },
  permission: { flex: 1, justifyContent: 'center', gap: space.lg },
  permissionActions: { width: '100%', maxWidth: 320, alignSelf: 'center', gap: space.sm },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: space.sm },
  overlayTop: { position: 'absolute', top: 0, start: 0, end: 0, paddingHorizontal: space.lg },
  hint: { alignSelf: 'center', paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill },
  controls: { position: 'absolute', bottom: 0, start: 0, end: 0, paddingHorizontal: space.lg },
  controlsRow: { flexDirection: 'row', alignItems: 'center' },
  // Equal side columns keep the shutter centred whatever the button label's length.
  side: { flex: 1, alignItems: 'flex-start' },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  shutterDisc: { width: 62, height: 62, borderRadius: 31 },
  photo: { width: '100%', aspectRatio: 4 / 3, maxHeight: 240, borderRadius: radius.lg, overflow: 'hidden' },
  card: { gap: space.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  badge: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill },
});
