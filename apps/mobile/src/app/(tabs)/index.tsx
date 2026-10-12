import * as Clipboard from 'expo-clipboard';
import { useNetworkState } from 'expo-network';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { Keyboard, Linking, Share, StyleSheet, TextInput, View, type ScrollView } from 'react-native';
import Animated, { LayoutAnimationConfig, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { REQUEST_LIMITS, isRtl } from '@translator/shared';
import { Banner } from '@/components/Banner';
import { Button, IconButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { LanguageBar, displayName } from '@/components/LanguageBar';
import { ListenHalo, Skeleton, enterDelayed, enterFade, enterUp, exitFade, layoutTransition, timing } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TappableText } from '@/components/TappableText';
import { Text, contentAlign } from '@/components/Text';
import { announce } from '@/lib/a11y';
import { authClient } from '@/lib/auth';
import { listHistory, type HistoryItem } from '@/lib/db';
import { errorActionLabel, toAppError, type AppError, type ErrorAction } from '@/lib/errors';
import { formatList, t, type StringKey } from '@/lib/i18n';
import { speak, stopSpeaking, useDictation } from '@/lib/speech';
import { setLanguages, useAppState } from '@/lib/store';
import {
  ModelMissingError,
  cloudCost,
  detectLanguage,
  downloadModels,
  downloadsWaitingForWifi,
  needsCareWarning,
  offlinePairQuality,
  planRoute,
  recordHistory,
  translateText,
  type Engine,
  type OfflineQuality,
  type TranslationResult,
} from '@/lib/translator';
import { iconSize, radius, space, touch, type as typeScale, useColors, useTabBarInset } from '@/theme';

/** Pause after typing before an on-device translation runs. */
const LIVE_DELAY_MS = 350;
/** A live result that stays unchanged this long counts as finished: it goes to history. */
const COMMIT_DELAY_MS = 2500;
const MAX_CHARS = REQUEST_LIMITS.maxTextChars;
/** History keeps 500 entries; a restore looks the entry up among them. */
const HISTORY_LOOKUP = 500;

const QUALITY_NOTE: Record<OfflineQuality, StringKey> = {
  good: 'offlineNoteGood',
  fair: 'offlineNoteFair',
  basic: 'offlineQualityNote',
};

// Results already saved to history (or restored from it), so a pause, a blur and a copy of the
// same result write it once.
const committed = new WeakSet<TranslationResult>();

function commit(result: TranslationResult | null) {
  if (!result || committed.has(result)) return;
  committed.add(result);
  void recordHistory(result);
}

const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const FIRST_LETTER = /\p{L}/u;

/** Before the language is known (auto-detect), the first letter decides the input's direction. */
function startsRtl(text: string): boolean {
  const first = text.match(FIRST_LETTER)?.[0];
  return !!first && RTL_LETTER.test(first);
}

export default function TranslateScreen() {
  const c = useColors();
  const source = useAppState((s) => s.source);
  const target = useAppState((s) => s.target);
  const downloading = useAppState((s) => s.downloading);
  useAppState((s) => s.downloadedModels); // re-plan when models change
  const { data: session } = authClient.useSession();
  const network = useNetworkState();
  const online = network.isInternetReachable !== false;
  const tabInset = useTabBarInset();
  const { restore } = useLocalSearchParams<{ restore?: string }>();

  const [text, setText] = useState('');
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [job, setJob] = useState<{ id: number; engine: Engine } | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [detected, setDetected] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [copiedAt, setCopiedAt] = useState(0);
  const [focused, setFocused] = useState(false);

  const request = useRef(0);
  const detectRequest = useRef(0);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const actionsRef = useRef<View>(null);
  const resultTop = useRef(0);
  const revealOnLayout = useRef(false);
  const revealAfterKeyboard = useRef(false);
  const ownSpeech = useRef(false);
  const latest = useRef<TranslationResult | null>(null);

  const input = text.trim();
  const route = planRoute(source === 'auto' && detected ? detected : source, target, { signedIn: !!session, online });
  const busy = !!job;

  const dictation = useDictation((spoken) => setText((prev) => (prev ? `${prev} ${spoken}` : spoken).slice(0, MAX_CHARS)));
  // With auto-detect, the language last detected is the best guess for what the user will say.
  const dictationLang = source === 'auto' ? (detected ?? 'auto') : source;
  const canDictate = dictation.canDictate(dictationLang);

  const isCurrent = (r: TranslationResult | null) => !!r && r.input === input && r.source === source && r.target === target;
  const current = isCurrent(result);
  // While typing with an on-device route, the previous result stays (dimmed) until the new one
  // arrives, unless that translation failed. A cloud result for older text is hidden instead:
  // a new one costs credits. A failed "Better quality" keeps the on-device result.
  const shown = input && result && (current || (route.kind === 'offline' && !error)) ? result : null;
  const updating = !!shown && (busy || !current);

  function run(engine: Engine) {
    if (!input) return;
    const id = ++request.current;
    // A cloud result appears where nothing was shown yet: scroll it into view once it lays out.
    const reveal = engine === 'cloud' && !shown;
    if (engine === 'cloud') Keyboard.dismiss();
    setJob({ id, engine });
    setError(null);
    // A promise chain rather than try/finally, which the React Compiler cannot optimize.
    translateText(input, source, target, { engine, record: engine === 'cloud' })
      .then(
        (r) => {
          if (id !== request.current) return;
          if (engine === 'cloud') {
            committed.add(r); // translateText already saved it
            announce(t('translationReady'));
          }
          revealOnLayout.current = reveal;
          setResult(r);
          if (r.detectedSource) setDetected(r.detectedSource);
        },
        (e: unknown) => {
          if (id !== request.current) return;
          // A missing model shows the download banner instead.
          setError(e instanceof ModelMissingError ? null : toAppError(e));
        },
      )
      .then(() => setJob((j) => (j?.id === id ? null : j)));
  }

  function changeText(value: string) {
    setText(value);
    if (!value.trim()) {
      request.current++; // drop a translation still on its way
      setResult(null);
      setJob(null);
      setError(null);
      setDetected(null);
    }
  }

  function clear() {
    if (dictation.listening) dictation.cancel();
    changeText('');
    inputRef.current?.focus();
  }

  /** Done (Return key or the keyboard button): the phrase is finished; show its result. */
  function finishEditing() {
    revealAfterKeyboard.current = !!shown;
    inputRef.current?.blur();
    Keyboard.dismiss();
  }

  /** Scrolls the result card up when its actions sit below the visible part of the page. */
  function revealResult() {
    const scroller = scrollRef.current;
    const page = scroller?.getNativeScrollRef();
    const actions = actionsRef.current;
    if (!scroller || !page || !actions) return;
    page.measureInWindow((_x, top, _w, height) => {
      actions.measureInWindow((_ax, y, _aw, h) => {
        if (y + h > top + height - tabInset) scroller.scrollTo({ y: Math.max(0, resultTop.current - space.lg), animated: true });
      });
    });
  }

  function act(action: ErrorAction, languages?: string[]) {
    switch (action) {
      case 'getCredits':
      case 'restorePurchases':
        return router.push('/plans');
      case 'signIn':
        return router.push('/sign-in');
      case 'openSettings':
        return void Linking.openSettings().catch(() => {});
      case 'chooseLanguage':
        return router.push({ pathname: '/languages', params: { side: 'source', allowAuto: '0' } });
      case 'download':
        return download(languages ?? (route.kind === 'download' ? route.missing : []));
    }
  }

  function download(languages: string[]) {
    if (!languages.length) return;
    setError(null);
    downloadModels(languages).catch((e: unknown) => setError(toAppError(e)));
  }

  function listen(r: TranslationResult) {
    commit(r);
    if (speaking) return stopSpeaking();
    ownSpeech.current = true;
    setSpeaking(true);
    speak(r.text, r.target, () => {
      ownSpeech.current = false;
      setSpeaking(false);
    });
  }

  function copy(r: TranslationResult) {
    commit(r);
    Clipboard.setStringAsync(r.text).catch(() => {});
    setCopiedAt(Date.now());
    announce(t('copied'));
  }

  function share(r: TranslationResult) {
    commit(r);
    Share.share({ message: r.text }).catch(() => {});
  }

  function betterQuality() {
    if (session) run('cloud');
    else router.push('/sign-in');
  }

  // Detect the language while typing (on-device, free). A slower, older detection never wins.
  useEffect(() => {
    if (source !== 'auto' || input.length < 3) return;
    const id = ++detectRequest.current;
    const timer = setTimeout(() => {
      void detectLanguage(input).then((d) => {
        if (d && id === detectRequest.current) setDetected(d);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [input, source]);

  // Live translation, but only when it is on-device and therefore free. Cloud translations cost
  // credits, so they only run when asked.
  const translateLive = useEffectEvent(() => {
    if (!isCurrent(result)) run('offline');
  });
  useEffect(() => {
    if (!input || route.kind !== 'offline') return;
    const timer = setTimeout(() => translateLive(), LIVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [input, source, target, route.kind]);

  // History only keeps finished phrases: a live result that stays unchanged for a moment, or
  // one the user copies, shares, listens to or leaves the screen with.
  const committable = current ? result : null;
  useEffect(() => {
    if (!committable || committable.engine !== 'offline' || committed.has(committable)) return;
    const timer = setTimeout(() => {
      commit(committable);
      announce(t('translationReady'));
    }, COMMIT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [committable]);

  useEffect(() => {
    latest.current = committable;
  });

  useFocusEffect(
    useCallback(
      () => () => {
        commit(latest.current);
        if (ownSpeech.current) stopSpeaking();
      },
      [],
    ),
  );

  useEffect(() => {
    if (!copiedAt) return;
    const timer = setTimeout(() => setCopiedAt(0), 1500);
    return () => clearTimeout(timer);
  }, [copiedAt]);

  useEffect(() => {
    if (dictation.phase === 'listening') announce(t('listening'));
  }, [dictation.phase]);

  const onKeyboardHidden = useEffectEvent(() => {
    if (!revealAfterKeyboard.current) return;
    revealAfterKeyboard.current = false;
    // Let the page take back the keyboard's space before measuring.
    setTimeout(() => revealResult(), 80);
  });
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => onKeyboardHidden());
    return () => sub.remove();
  }, []);

  // A history entry was tapped: History passes its id (never the text itself) back to this tab.
  const applyRestore = useEffectEvent((item: HistoryItem) => {
    const keepAuto = source === 'auto';
    const from = keepAuto ? 'auto' : item.source;
    const restored: TranslationResult = {
      text: item.output,
      engine: item.engine,
      detectedSource: item.source === 'auto' ? null : item.source,
      charged: 0,
      input: item.input,
      source: from,
      target: item.target,
    };
    committed.add(restored);
    request.current++;
    if (dictation.listening) dictation.cancel();
    setLanguages(from, item.target);
    setText(item.input);
    setResult(restored);
    setJob(null);
    setError(null);
    setDetected(restored.detectedSource);
    announce(t('translationReady'));
  });
  useEffect(() => {
    const id = Number(restore);
    if (!restore || !Number.isInteger(id)) return;
    let live = true;
    listHistory(HISTORY_LOOKUP)
      .then((items) => {
        const item = items.find((i) => i.id === id);
        if (live && item) applyRestore(item);
      })
      .catch(() => {})
      .then(() => {
        if (live) router.setParams({ restore: undefined });
      });
    return () => {
      live = false;
    };
  }, [restore]);

  // While a newer translation is on its way, the old one dims instead of being replaced by a spinner.
  const dimStyle = useAnimatedStyle(() => ({ opacity: withTiming(updating ? 0.5 : 1, timing.fast) }));

  const inputLang = source === 'auto' ? detected : source;
  const rtlInput = inputLang ? isRtl(inputLang) : startsRtl(text);
  const missing = route.kind === 'download' ? route.missing : [];
  const isDownloading = missing.some((m) => m in downloading);
  const waitingForWifi = isDownloading && downloadsWaitingForWifi(network.type);
  const cloudOffer = !!input && !current && (route.kind === 'cloud' || (route.kind === 'download' && route.cloudPossible));
  const speechError = dictation.failure ? toAppError(dictation.failure) : null;
  const speechAction = speechError?.action;
  const errorAction = error?.action;
  const errorLanguages = error?.languages;

  const routeNotice = input ? route.kind : null;
  const hasNotice =
    !!speechError?.message || routeNotice === 'download' || routeNotice === 'sign-in' || routeNotice === 'no-connection' || !!error?.message;

  return (
    <Screen tab scrollRef={scrollRef}>
      <ScreenHeader
        title={t('tabTranslate')}
        trailing={<IconButton icon="history" label={t('history')} onPress={() => router.push('/history')} />}
      />

      <LanguageBar detected={detected} />

      <Card selected={focused} style={styles.inputCard}>
        <TextInput
          ref={inputRef}
          value={dictation.listening && dictation.partial ? `${text}${text ? ' ' : ''}${dictation.partial}` : text}
          onChangeText={changeText}
          editable={!dictation.listening}
          placeholder={dictation.listening ? t('listening') : t('typeHere')}
          placeholderTextColor={c.textMuted}
          cursorColor={c.accent}
          selectionColor={c.accent}
          selectionHandleColor={c.accent}
          multiline
          maxLength={MAX_CHARS}
          maxFontSizeMultiplier={2}
          autoCorrect
          textAlignVertical="top"
          // Return finishes the phrase: it hides the keyboard so the result and its actions show.
          returnKeyType="done"
          enterKeyHint="done"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={finishEditing}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit(committable);
          }}
          accessibilityLabel={t('typeHere')}
          style={[
            styles.input,
            typeScale.input,
            { color: c.text, writingDirection: rtlInput ? 'rtl' : 'ltr', textAlign: contentAlign(rtlInput) },
          ]}
        />
        <View style={styles.inputActions}>
          <View style={styles.mic}>
            <ListenHalo active={dictation.listening} color={c.accent} radius={touch.min / 2} />
            <IconButton
              icon={dictation.listening ? 'stop' : 'mic'}
              label={dictation.listening ? t('stopListening') : t('tapToSpeak')}
              active={dictation.listening}
              tint={canDictate ? undefined : c.textFaint}
              accessibilityHint={
                canDictate
                  ? undefined
                  : dictationLang === 'auto' || !dictation.available
                    ? t('speechUnavailable')
                    : t('speechLanguageUnsupportedNamed', { lang: displayName(dictationLang) })
              }
              onPress={() => {
                if (dictation.listening) return dictation.stop();
                Keyboard.dismiss();
                dictation.start(dictationLang).catch(() => {});
              }}
            />
          </View>
          <View style={styles.flex} />
          {text.length > 0 && (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {t('charCount', { count: text.length, max: MAX_CHARS })}
            </Text>
          )}
          {focused && (
            <Animated.View entering={enterFade} exiting={exitFade}>
              <IconButton icon="keyboardDown" label={t('done')} onPress={finishEditing} />
            </Animated.View>
          )}
          {text.length > 0 && <IconButton icon="close" label={t('clear')} onPress={clear} />}
        </View>
      </Card>

      {hasNotice && (
        <Animated.View layout={layoutTransition} style={styles.notices}>
          {speechError?.message ? (
            <Banner
              icon="mic"
              tone={dictation.error === 'no-speech' ? 'info' : 'warning'}
              message={speechError.message}
              action={speechAction ? errorActionLabel(speechAction) : undefined}
              onAction={speechAction ? () => act(speechAction) : undefined}
              onDismiss={dictation.clearError}
            />
          ) : null}
          {routeNotice === 'download' && (
            <Banner
              icon="download"
              message={waitingForWifi ? t('waitingForWifi') : t('downloadToUseOffline', { lang: formatList(missing.map((m) => displayName(m))) })}
              action={waitingForWifi ? undefined : t('download')}
              loading={isDownloading}
              onAction={waitingForWifi ? undefined : () => download(missing)}
            />
          )}
          {routeNotice === 'sign-in' && (
            <Banner
              icon="cloud"
              message={t('signInForCloud', { lang: displayName(target) })}
              action={t('signIn')}
              onAction={() => router.push('/sign-in')}
            />
          )}
          {routeNotice === 'no-connection' && <Banner icon="cloudOff" tone="warning" message={t('needsInternet', { lang: displayName(target) })} />}
          {error?.message ? (
            <Banner
              tone="danger"
              message={error.message}
              action={errorAction ? errorActionLabel(errorAction) : undefined}
              onAction={errorAction ? () => act(errorAction, errorLanguages) : undefined}
              onDismiss={() => setError(null)}
            />
          ) : null}
        </Animated.View>
      )}

      {cloudOffer && (
        <Animated.View entering={enterFade} exiting={exitFade} layout={layoutTransition}>
          <Button
            title={`${t('translate')} · ${t('costCredits', { credits: cloudCost(input) })}`}
            icon="cloud"
            onPress={() => run('cloud')}
            loading={job?.engine === 'cloud'}
          />
        </Animated.View>
      )}

      {busy && !shown && (
        // Waits 120 ms before fading in, so a fast on-device result never flashes a placeholder;
        // it is simply replaced when the result arrives.
        <LayoutAnimationConfig skipExiting>
          <Card tone="accent" entering={enterDelayed} layout={layoutTransition} style={styles.resultCard}>
            <Text variant="eyebrow" tone="accent">
              {displayName(target)}
            </Text>
            <Skeleton lines={2} label={t('translating')} />
          </Card>
        </LayoutAnimationConfig>
      )}

      {shown && (
        <Card
          tone="accent"
          entering={enterUp}
          exiting={exitFade}
          layout={layoutTransition}
          style={styles.resultCard}
          onLayout={(e) => {
            resultTop.current = e.nativeEvent.layout.y;
            if (revealOnLayout.current) {
              revealOnLayout.current = false;
              setTimeout(() => revealResult(), 0);
            }
          }}>
          <View style={styles.resultHead}>
            <Text variant="eyebrow" tone="accent" style={styles.shrink}>
              {displayName(shown.target)}
            </Text>
            <View style={[styles.badge, { backgroundColor: c.surface }]}>
              <Icon name={shown.engine === 'offline' ? 'device' : 'cloud'} size={iconSize.xs} color={c.textMuted} />
              <Text variant="micro" tone="muted" numberOfLines={1}>
                {shown.engine === 'offline' ? t('offlineBadge') : t('cloudBadge')}
              </Text>
            </View>
          </View>

          <Animated.View style={dimStyle} accessibilityState={{ busy: updating }}>
            <TappableText
              text={shown.text}
              lang={shown.target}
              variant="result"
              onWord={(word) => router.push({ pathname: '/word', params: { word, lang: shown.target } })}
            />
          </Animated.View>

          <View ref={actionsRef} style={styles.resultActions}>
            <IconButton icon={speaking ? 'stop' : 'speaker'} label={speaking ? t('stop') : t('listen')} onPress={() => listen(shown)} />
            <IconButton icon={copiedAt ? 'check' : 'copy'} label={copiedAt ? t('copied') : t('copy')} onPress={() => copy(shown)} />
            <IconButton icon="share" label={t('share')} onPress={() => share(shown)} />
          </View>

          {shown.engine === 'offline' && (
            <OfflineNote
              result={shown}
              online={online}
              signedIn={!!session}
              loading={job?.engine === 'cloud'}
              onBetterQuality={betterQuality}
            />
          )}

          <Text variant="caption" tone="muted">
            {t('tapWordHint')}
          </Text>
        </Card>
      )}
    </Screen>
  );
}

/**
 * Under an on-device result: how good on-device translation is for this pair, or, for medical,
 * legal or emergency text, a warning to double-check. Both offer the cloud translation.
 */
function OfflineNote({
  result,
  online,
  signedIn,
  loading,
  onBetterQuality,
}: {
  result: TranslationResult;
  online: boolean;
  signedIn: boolean;
  loading: boolean;
  onBetterQuality: () => void;
}) {
  const c = useColors();
  const from = result.detectedSource ?? result.source;
  if (from === result.target) return null;
  const care = needsCareWarning(result.input);
  const credits = cloudCost(result.input);
  const hint = signedIn ? t('betterQualityHint', { credits }) : t('signInForCloud', { lang: displayName(result.target) });

  const action = online ? (
    <View style={styles.noteAction}>
      <Button
        title={t('betterQuality')}
        icon="sparkles"
        kind={care ? 'primary' : 'secondary'}
        compact
        loading={loading}
        accessibilityHint={hint}
        onPress={onBetterQuality}
      />
      {signedIn && (
        <Text variant="caption" tone="muted" style={styles.shrink}>
          {t('costCredits', { credits })}
        </Text>
      )}
    </View>
  ) : null;

  if (care) {
    return (
      <Animated.View entering={enterFade} style={[styles.care, { backgroundColor: c.warningSoft }]}>
        <Icon name="warning" size={iconSize.md} color={c.warning} />
        <View style={styles.careBody}>
          <Text variant="label" heading>
            {t('medicalWarningTitle')}
          </Text>
          <Text variant="caption">{t('medicalWarning')}</Text>
          {action}
        </View>
      </Animated.View>
    );
  }

  return (
    <View style={styles.note}>
      <View style={styles.noteRow}>
        <Icon name="device" size={iconSize.sm} color={c.textMuted} />
        <Text variant="caption" tone="muted" style={styles.shrink}>
          {t(QUALITY_NOTE[offlinePairQuality(from, result.target)])}
        </Text>
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  inputCard: { gap: space.sm, paddingBottom: space.sm },
  input: { minHeight: 120, maxHeight: 280, padding: 0 },
  inputActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginStart: -space.sm },
  // Same size as the mic button, so the halo is centred behind it.
  mic: { width: touch.min, height: touch.min },
  notices: { gap: space.sm },
  resultCard: { gap: space.md },
  resultHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  // gap sm keeps the 48 pt hit areas of neighbouring icon buttons from overlapping.
  resultActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginStart: -space.sm },
  note: { gap: space.sm },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  noteAction: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  care: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md, borderRadius: radius.md },
  careBody: { flex: 1, minWidth: 0, gap: space.xs },
});
