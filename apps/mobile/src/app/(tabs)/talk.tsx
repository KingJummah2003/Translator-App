import { useNetworkState } from 'expo-network';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, FlatList, Linking, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getLanguage } from '@translator/shared';
import { Banner } from '@/components/Banner';
import { IconButton } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { LanguagePill, SwapButton, displayName } from '@/components/LanguageBar';
import { LayoutAnimationConfig, ListenHalo, PressableScale, enterBubble, enterPop, exitFade, useTabFade } from '@/components/motion';
import { Text } from '@/components/Text';
import { announce, useScreenReaderEnabled } from '@/lib/a11y';
import { authClient } from '@/lib/auth';
import { errorActionLabel, errorMessage, toAppError, type AppError } from '@/lib/errors';
import { formatList, t, tFor, uiLanguage, type StringKey } from '@/lib/i18n';
import { speak, stopSpeaking, useDictation } from '@/lib/speech';
import { setLanguages, updateSettings, useAppState } from '@/lib/store';
import { downloadModels, offlineCapable, planRoute, translateText, type Route } from '@/lib/translator';
import { iconSize, radius, space, useColors, useTabBarInset } from '@/theme';

type Side = 'me' | 'them';

interface Message {
  id: number;
  from: Side;
  original: string;
  translated: string;
  /** The languages when it was said, so a later language change never mislabels it. */
  source: string;
  target: string;
}

/** A message as one side sees it: their own words, or the translation into their language. */
interface Line {
  id: number;
  own: boolean;
  text: string;
  lang: string;
}

type MicState = 'idle' | 'listening' | 'busy';
type FocusTarget = LayoutChangeEvent['currentTarget'];

/** Text for one side: the other person gets their own language when the app has it (en, ar). */
function textFor(side: Side, lang: string, key: StringKey): { text: string; language?: string } {
  if (side === 'me') return { text: t(key) };
  const theirs = tFor(lang, key);
  return theirs ? { text: theirs, language: lang } : { text: t(key) };
}

/** Why the pair can't be translated right now, for the banner between the panels. */
function routeNotice(route: Route, mine: string, theirs: string): { message: string; icon: IconName } | null {
  // The language that has no on-device model, which is why the cloud is needed.
  const cloudLang = displayName([theirs, mine].find((code) => !offlineCapable(code)) ?? theirs);
  switch (route.kind) {
    case 'download':
      return { message: t('downloadToUseOffline', { lang: formatList(route.missing.map(displayName)) }), icon: 'download' };
    case 'sign-in':
      return { message: t('signInForCloud', { lang: cloudLang }), icon: 'cloud' };
    case 'no-connection':
      return { message: t('needsInternet', { lang: cloudLang }), icon: 'cloudOff' };
    default:
      return null;
  }
}

/**
 * Face-to-face conversation. The phone lies between two people: the top half is turned
 * around for the other person. Each side speaks in their own language; the translation
 * appears on the other side and is read aloud. Deliberately headerless: both halves need the
 * full height, and each starts with its own language chip.
 */
export default function TalkScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const bottomInset = useTabBarInset();
  const fade = useTabFade();
  const navigation = useNavigation();
  const screenReader = useScreenReaderEnabled();
  const source = useAppState((s) => s.source);
  const target = useAppState((s) => s.target);
  const autoSpeak = useAppState((s) => s.settings.autoSpeak);
  // planRoute reads the downloaded models from the store: re-render when they change.
  useAppState((s) => s.downloadedModels);
  const downloading = useAppState((s) => s.downloading);
  const { data: session } = authClient.useSession();
  const network = useNetworkState();
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState<Side | null>(null);
  const [error, setError] = useState<unknown>(null);
  /** `${side}:${id}` of the bubble being read aloud. */
  const [speaking, setSpeaking] = useState<string | null>(null);
  const nextId = useRef(1);
  const micHost = useRef<FocusTarget | null>(null);
  const focusMic = useRef(true);

  const mine = source === 'auto' ? uiLanguage : source;
  const theirs = target;
  const ctx = { signedIn: !!session, online: network.isInternetReachable !== false };
  const route = planRoute(mine, theirs, ctx);
  const ready = route.kind === 'offline' || route.kind === 'cloud';

  function readAloud(text: string, lang: string, key: string) {
    setSpeaking(key);
    speak(text, lang, () => setSpeaking((current) => (current === key ? null : current)));
  }

  function handleSpoken(text: string, side: Side) {
    const from = side === 'me' ? mine : theirs;
    const to = side === 'me' ? theirs : mine;
    const r = planRoute(from, to, ctx);
    if (r.kind !== 'offline' && r.kind !== 'cloud') {
      // The banner already shows why; the speaker just finished talking, so say it too.
      announce(routeNotice(r, mine, theirs)?.message);
      return;
    }
    const id = nextId.current++;
    const listener: Side = side === 'me' ? 'them' : 'me';
    setBusy(side);
    setError(null);
    // A promise chain, not try/finally, which the React Compiler can't optimise yet.
    translateText(text, from, to, { engine: r.kind })
      .then((result) => {
        if (!result.text) return;
        setMessages((m) => [...m, { id, from: side, original: text, translated: result.text, source: from, target: to }]);
        if (autoSpeak) readAloud(result.text, to, `${listener}:${id}`);
        else announce(result.text);
      })
      .catch((e: unknown) => setError(e))
      .finally(() => setBusy(null));
  }

  // The hook stops listening by itself on blur, unmount and when the app goes to the background.
  const dictation = useDictation((text, tag) => handleSpoken(text, tag === 'them' ? 'them' : 'me'));

  // Screen readers order the screen top to bottom, which would start on the other person's
  // upside-down panel. Arriving on the tab moves focus to the owner's mic instead (not when a
  // sheet such as the language list closes: focus stays where the user was).
  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (screenReader && focusMic.current) {
        focusMic.current = false;
        timer = setTimeout(() => {
          const host = micHost.current;
          if (host) AccessibilityInfo.sendAccessibilityEvent(host, 'focus');
        }, 600);
      }
      return () => {
        if (timer) clearTimeout(timer);
        if (navigation.getParent()?.isFocused()) focusMic.current = true;
      };
    }, [navigation, screenReader]),
  );

  const download = (languages: string[]) => {
    downloadModels(languages).then(
      () => setError(null),
      (e: unknown) => setError(e),
    );
  };

  const runAction = (e: AppError) => {
    switch (e.action) {
      case 'getCredits':
      case 'restorePurchases':
        return router.push('/plans');
      case 'signIn':
        return router.push('/sign-in');
      case 'openSettings':
        return void Linking.openSettings();
      case 'download':
        return download(e.languages?.length ? e.languages : route.kind === 'download' ? route.missing : [mine, theirs]);
      case 'chooseLanguage':
        return router.push({ pathname: '/languages', params: { side: 'target', allowAuto: '0' } });
    }
  };

  const replay = (side: Side, line: Line) => {
    const key = `${side}:${line.id}`;
    if (speaking === key) return stopSpeaking();
    readAloud(line.text, line.lang, key);
  };

  const toggleMic = (side: Side, lang: string) => {
    if (dictation.listening && dictation.tag === side) return dictation.stop();
    void dictation.start(lang, side);
  };

  // Newest first, for the inverted lists.
  const linesFor = (side: Side): Line[] =>
    messages
      .map((m) =>
        m.from === side ? { id: m.id, own: true, text: m.original, lang: m.source } : { id: m.id, own: false, text: m.translated, lang: m.target },
      )
      .reverse();

  const micFor = (side: Side, lang: string) => {
    const listening = dictation.listening && dictation.tag === side;
    const state: MicState = listening ? 'listening' : busy === side ? 'busy' : 'idle';
    const usable = ready && dictation.canDictate(lang);
    const disabled = !listening && (busy !== null || dictation.listening || !usable);
    return (
      <MicButton
        side={side}
        lang={lang}
        state={state}
        open={listening && dictation.phase === 'listening'}
        partial={listening ? dictation.partial : ''}
        disabled={disabled}
        onPress={() => toggleMic(side, lang)}
        onLayout={
          side === 'me'
            ? (e) => {
                micHost.current = e.currentTarget;
              }
            : undefined
        }
      />
    );
  };

  const noteFor = (side: Side, lang: string) => {
    const key: StringKey | null = !dictation.available ? 'speechUnavailable' : !dictation.canDictate(lang) ? 'speechLanguageUnsupported' : null;
    return key ? textFor(side, lang, key) : null;
  };

  const panel = (side: Side) => {
    const lang = side === 'me' ? mine : theirs;
    const head =
      side === 'me' ? (
        <>
          {/* The label fades in when the language changes, not when the screen first appears. */}
          <LayoutAnimationConfig skipEntering>
            <LanguagePill side="source" code={mine} allowAuto={false} />
          </LayoutAnimationConfig>
          <SwapButton onPress={() => setLanguages(theirs, mine)} disabled={dictation.listening || busy !== null} />
          <IconButton icon="speaker" label={t('autoSpeak')} active={autoSpeak} toggle onPress={() => updateSettings({ autoSpeak: !autoSpeak })} />
        </>
      ) : (
        <LayoutAnimationConfig skipEntering>
          <LanguagePill side="target" code={theirs} allowAuto={false} label={getLanguage(theirs)?.native} labelLanguage={theirs} />
        </LayoutAnimationConfig>
      );
    return (
      <Panel
        side={side}
        lang={lang}
        lines={linesFor(side)}
        head={head}
        mic={micFor(side, lang)}
        note={noteFor(side, lang)}
        speaking={speaking}
        canReplay={!dictation.listening}
        onReplay={(line) => replay(side, line)}
      />
    );
  };

  // One notice at a time between the panels: speech problems first, then translation errors,
  // then what the language pair needs.
  const speechMessage = dictation.failure ? errorMessage(dictation.failure) : '';
  const appError = error ? toAppError(error) : null;
  const notice = routeNotice(route, mine, theirs);
  let banner: ReactNode = null;
  if (speechMessage && dictation.failure) {
    const settings = toAppError(dictation.failure).action === 'openSettings';
    banner = (
      <Banner
        key="speech"
        icon="mic"
        tone={dictation.error === 'no-speech' ? 'info' : 'warning'}
        message={speechMessage}
        action={settings ? t('openSettings') : undefined}
        onAction={settings ? () => void Linking.openSettings() : undefined}
        onDismiss={dictation.clearError}
      />
    );
  } else if (appError?.message) {
    const languages = appError.languages ?? [];
    banner = (
      <Banner
        key="error"
        tone="danger"
        message={appError.message}
        action={appError.action ? errorActionLabel(appError.action) : undefined}
        onAction={appError.action ? () => runAction(appError) : undefined}
        loading={appError.action === 'download' && languages.some((l) => l in downloading)}
        onDismiss={() => setError(null)}
      />
    );
  } else if (notice) {
    banner = (
      <Banner
        key={`route-${route.kind}`}
        icon={notice.icon}
        tone={route.kind === 'no-connection' ? 'warning' : 'info'}
        message={notice.message}
        action={route.kind === 'download' ? t('download') : route.kind === 'sign-in' ? t('signIn') : undefined}
        onAction={route.kind === 'download' ? () => download(route.missing) : route.kind === 'sign-in' ? () => router.push('/sign-in') : undefined}
        loading={route.kind === 'download' && route.missing.some((l) => l in downloading)}
      />
    );
  }

  return (
    // column-reverse: the owner's panel comes first for screen readers but sits at the bottom.
    <Animated.View style={[styles.root, { backgroundColor: c.bg, paddingBottom: bottomInset }, fade]}>
      {panel('me')}
      <View style={[styles.notices, banner ? styles.noticesOpen : null]}>{banner}</View>
      <View style={[styles.divider, { backgroundColor: c.border }]} />
      {panel('them')}
      {/* The status bar takes the colour of the panel under it, so there is no seam. */}
      <View style={{ height: insets.top, backgroundColor: c.surfaceAlt }} />
    </Animated.View>
  );
}

function Panel({
  side,
  lang,
  lines,
  head,
  mic,
  note,
  speaking,
  canReplay,
  onReplay,
}: {
  side: Side;
  lang: string;
  lines: Line[];
  head: ReactNode;
  mic: ReactNode;
  note: { text: string; language?: string } | null;
  speaking: string | null;
  canReplay: boolean;
  onReplay: (line: Line) => void;
}) {
  const c = useColors();
  const flipped = side === 'them';
  // The other person only gets a hint when the app speaks their language.
  const hint = flipped ? tFor(lang, 'talkHint') : t('talkHint');
  return (
    <View style={[styles.panel, flipped && styles.flipped, { backgroundColor: flipped ? c.surfaceAlt : c.bg }]}>
      <View style={styles.head}>{head}</View>
      <FlatList
        data={lines}
        inverted
        keyExtractor={(l) => String(l.id)}
        contentContainerStyle={styles.lines}
        ListEmptyComponent={
          hint ? (
            <Text variant="caption" tone="muted" align="center" language={flipped ? lang : undefined} style={styles.empty}>
              {hint}
            </Text>
          ) : null
        }
        renderItem={({ item, index }) => (
          <Bubble line={item} newest={index === 0} speaking={speaking === `${side}:${item.id}`} disabled={!canReplay} onPress={() => onReplay(item)} />
        )}
      />
      {note ? (
        <Text variant="caption" tone="muted" align="center" language={note.language} style={styles.note}>
          {note.text}
        </Text>
      ) : null}
      {mic}
    </View>
  );
}

/** One message. Tap to hear it again in this side's language; tap again to stop. */
function Bubble({ line, newest, speaking, disabled, onPress }: { line: Line; newest: boolean; speaking: boolean; disabled: boolean; onPress: () => void }) {
  const c = useColors();
  const fg = line.own ? c.onAccent : c.accent;
  return (
    // Only the newest bubble animates, so scrolling back through recycled cells never replays
    // an entrance. It sits on a wrapper because PressableScale owns the transform.
    <Animated.View entering={newest ? enterBubble : undefined} style={line.own ? styles.own : styles.other}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={line.text}
        accessibilityLanguage={getLanguage(line.lang)?.speech ?? line.lang}
        accessibilityHint={speaking ? t('talkStopReadingHint') : t('talkReplayHint')}
        accessibilityState={{ disabled, busy: speaking }}
        disabled={disabled}
        scaleTo={0.98}
        highlight={c.pressed}
        onPress={onPress}
        style={[
          styles.bubble,
          line.own ? styles.ownCorner : styles.otherCorner,
          { backgroundColor: line.own ? c.accent : c.surface, borderColor: c.border },
        ]}>
        <Text variant="body" tone={line.own ? 'onAccent' : 'default'} language={line.lang} style={styles.bubbleText}>
          {line.text}
        </Text>
        {speaking ? (
          <Animated.View entering={enterPop} exiting={exitFade} style={styles.bubbleIcon}>
            <Icon name="speaker" size={iconSize.sm} color={fg} />
          </Animated.View>
        ) : null}
      </PressableScale>
    </Animated.View>
  );
}

/**
 * The big button of one side. Its text is in that person's language where the app has it; the
 * screen-reader label stays in the interface language, because the screen reader belongs to the
 * phone's owner.
 */
function MicButton({
  side,
  lang,
  state,
  open,
  partial,
  disabled,
  onPress,
  onLayout,
}: {
  side: Side;
  lang: string;
  state: MicState;
  /** The microphone is actually open (not still preparing). */
  open: boolean;
  partial: string;
  disabled: boolean;
  onPress: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const c = useColors();
  const listening = state === 'listening';
  const isBusy = state === 'busy';
  // Busy keeps the accent: it's this side's words being translated, not a dead button.
  const inactive = disabled && !isBusy;
  const bg = listening ? c.danger : inactive ? (side === 'them' ? c.surface : c.surfaceAlt) : c.accent;
  const fg = inactive ? c.textFaint : c.onAccent;

  const key: StringKey = listening ? 'listening' : isBusy ? 'translating' : 'holdToTalk';
  // Without interface strings in their language, the other person sees its native name ("Français").
  const label =
    listening && partial
      ? { text: partial, language: lang }
      : side === 'me'
        ? { text: t(key) }
        : { text: tFor(lang, key) ?? getLanguage(lang)?.native ?? displayName(lang), language: lang };

  const name = displayName(lang);
  const spoken = listening ? `${t('stop')}, ${name}` : isBusy ? t('translating') : `${t('holdToTalk')}, ${name}`;
  const glyph = isBusy ? 'busy' : listening ? 'stop' : 'mic';

  return (
    <View>
      <ListenHalo active={open} color={c.danger} radius={radius.pill} scale={{ x: 1.06, y: 1.45 }} />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityState={{ disabled, busy: isBusy }}
        disabled={disabled}
        highlight={c.pressed}
        onPress={onPress}
        onLayout={onLayout}
        style={[styles.mic, { backgroundColor: bg, borderColor: inactive ? c.border : bg }]}>
        {/* The glyph pops when it changes (mic -> stop -> spinner), never on first render. */}
        <LayoutAnimationConfig skipEntering>
          <Animated.View key={glyph} entering={enterPop} style={styles.micGlyph}>
            {isBusy ? <ActivityIndicator color={fg} /> : <Icon name={listening ? 'stop' : 'mic'} size={iconSize.lg} color={fg} />}
          </Animated.View>
        </LayoutAnimationConfig>
        <Text
          variant="button"
          align="center"
          language={label.language}
          // Live words show their newest end on one line.
          numberOfLines={listening && partial ? 1 : 2}
          ellipsizeMode={listening && partial ? 'head' : 'tail'}
          style={[styles.micLabel, { color: fg }]}>
          {label.text}
        </Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'column-reverse' },
  panel: { flex: 1, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm },
  flipped: { transform: [{ rotate: '180deg' }] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  lines: { gap: space.sm, paddingVertical: space.sm, flexGrow: 1, justifyContent: 'flex-end' },
  empty: { paddingHorizontal: space.xl },
  own: { maxWidth: '85%', alignSelf: 'flex-end' },
  other: { maxWidth: '85%', alignSelf: 'flex-start' },
  bubble: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    // Clips the pressed wash to the tail corner.
    overflow: 'hidden',
  },
  // The corner nearest the speaker is tighter, like a speech-bubble tail.
  ownCorner: { borderBottomEndRadius: 6 },
  otherCorner: { borderBottomStartRadius: 6 },
  bubbleText: { flexShrink: 1 },
  bubbleIcon: { paddingBottom: 3 },
  mic: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 56,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
  },
  micGlyph: { width: iconSize.lg, height: iconSize.lg, alignItems: 'center', justifyContent: 'center' },
  micLabel: { flexShrink: 1 },
  note: { paddingHorizontal: space.lg },
  notices: { paddingHorizontal: space.lg },
  noticesOpen: { paddingVertical: space.sm },
  divider: { height: StyleSheet.hairlineWidth },
});
