import { getLocales } from 'expo-localization';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import {
  dialectName,
  isLanguageCode,
  isRtl,
  orderDialects,
  type DictionaryResponse,
  type DictionarySense,
} from '@translator/shared';
import { IconButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { ModalHeader } from '@/components/ModalHeader';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Skeleton, enterDelayed, enterFade, exitFade, layoutTransition, listItem } from '@/components/motion';
import { announce } from '@/lib/a11y';
import { ApiError, apiJson } from '@/lib/api';
import { cacheEntry, getCachedEntry } from '@/lib/db';
import { errorCode, errorMessage } from '@/lib/errors';
import { dialectName as varietyName, languageName, partOfSpeechLabel, t, uiLanguage } from '@/lib/i18n';
import { dismiss } from '@/lib/nav';
import { speak, stopSpeaking } from '@/lib/speech';
import { useAppState } from '@/lib/store';
import { planRoute, translateText } from '@/lib/translator';
import { iconSize, radius, space, useColors } from '@/theme';

/** Local cache namespace. v3 entries carry dialect senses, so entries cached before that are skipped. */
const CACHE_NS = `v3:${uiLanguage}`;
/** The phone's region puts the local dialect first (a Kuwaiti user sees Gulf Arabic first). */
const REGION = getLocales()[0]?.regionCode ?? null;
/** Definitions translated on the device per entry (each one is a model call). */
const GLOSS_LIMIT = 24;
const ON_DEVICE_ONLY = { signedIn: false, online: false };

/* ------------------------------------------------------------------ params and data */

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
// Deep links and older callers can pass a token with quotes or sentence punctuation around it.
const EDGE_PUNCTUATION = /^[\p{P}\s]+|[\p{P}\s]+$/gu;
const cleanWord = (v: string | undefined) => (v ?? '').replace(EDGE_PUNCTUATION, '');

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Accepts only the shape the screen can render; anything else from the network or the cache is dropped. */
function parseEntry(raw: unknown): DictionaryResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.senses)) return null;
  const senses: DictionarySense[] = [];
  for (const item of r.senses as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const definitions = (Array.isArray(s.definitions) ? (s.definitions as unknown[]) : [])
      .map((d) => {
        const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
        const examples = Array.isArray(o.examples) ? (o.examples as unknown[]).map(str).filter(Boolean) : [];
        return { text: str(o.text), examples };
      })
      .filter((d) => d.text);
    if (!definitions.length) continue;
    const dialect = str(s.dialect);
    senses.push({ partOfSpeech: str(s.partOfSpeech), language: str(s.language), ...(dialect ? { dialect } : {}), definitions });
  }
  return { word: str(r.word), lang: str(r.lang), senses, source: str(r.source) };
}

async function fetchEntry(word: string, lang: string): Promise<DictionaryResponse> {
  const raw = await apiJson<unknown>(`/v1/dictionary?word=${encodeURIComponent(word)}&lang=${encodeURIComponent(lang)}`);
  const entry = parseEntry(raw);
  if (!entry) throw new ApiError(200, 'internal', 'Malformed dictionary response');
  return entry;
}

interface Failure {
  offline: boolean;
  detail: string;
}

function toFailure(e: unknown): Failure | null {
  const code = errorCode(e);
  // A word the API refuses (too long, contains a slash) or doesn't know simply has no entry.
  if (code === 'bad_request' || code === 'not_found') return null;
  if (code === 'network') return { offline: true, detail: '' };
  // These two messages talk about the translation service; the title already says what failed.
  return { offline: false, detail: code === 'upstream_error' || code === 'service_paused' ? '' : errorMessage(e) };
}

interface Lookup {
  entry: DictionaryResponse | null;
  /** The network request is still out. */
  loading: boolean;
  /** The entry on screen is stored on this phone. */
  saved: boolean;
  failure: Failure | null;
}

const LOADING: Lookup = { entry: null, loading: true, saved: false, failure: null };

/* ------------------------------------------------------------------ layout */

interface SenseBlock {
  key: string;
  sense: DictionarySense;
  /** Position in the entrance stagger. */
  index: number;
  /** Which variety a standard sense belongs to, when the entry mixes several (Bokmål and Nynorsk). */
  variety: string | null;
}

interface DialectGroup {
  name: string;
  label: string;
  index: number;
  senses: SenseBlock[];
}

/** Standard senses first, then one group per dialect, the user's regional dialect leading. */
function arrange(senses: DictionarySense[], lang: string) {
  let index = 0;
  const standardSenses = senses.filter((s) => !s.dialect);
  const mixed = new Set(standardSenses.map((s) => s.language)).size > 1;
  const standard: SenseBlock[] = standardSenses.map((sense, i) => ({
    key: `standard-${i}`,
    sense,
    index: index++,
    variety: mixed && sense.language ? varietyName(sense.language) : null,
  }));

  const byDialect = new Map<string, DictionarySense[]>();
  for (const s of senses) {
    if (s.dialect) byDialect.set(s.dialect, [...(byDialect.get(s.dialect) ?? []), s]);
  }
  const preferred = orderDialects(lang, REGION);
  const rank = (name: string) => {
    const i = preferred.indexOf(name);
    return i === -1 ? preferred.length : i;
  };
  const names = [...byDialect.keys()]
    .map((name, i) => ({ name, i }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.i - b.i)
    .map((d) => d.name);

  const alsoIndex = standard.length && names.length ? index++ : null;
  const dialects: DialectGroup[] = names.map((name) => ({
    name,
    label: dialectName(name, uiLanguage),
    index: index++,
    senses: (byDialect.get(name) ?? []).map((sense, i) => ({ key: `${name}-${i}`, sense, index: index++, variety: null })),
  }));
  return { standard, alsoIndex, dialects };
}

/** Example sentences are quoted the way their own script quotes (curly quotes mirror wrongly in Arabic). */
function quote(text: string, lang: string): string {
  if (isRtl(lang)) return `«${text}»`;
  if (lang === 'ja' || lang.startsWith('zh')) return `「${text}」`;
  return `“${text}”`;
}

/* ------------------------------------------------------------------ glosses */

/** Definitions translated into the interface language, kept for the session. */
const glossCache = new Map<string, string>();

/**
 * English Wiktionary defines every word in English. In the Arabic interface each definition is
 * also translated on the device (when the models are there), one at a time, reported as they land.
 */
function translateGlosses(texts: string[], onUpdate: (glosses: Record<string, string>) => void, cancelled: () => boolean): void {
  void (async () => {
    const found: Record<string, string> = {};
    let unreported = false;
    for (const text of texts) {
      if (cancelled()) return;
      const known = glossCache.get(text);
      if (known !== undefined) {
        found[text] = known;
        unreported = true;
        continue;
      }
      if (unreported) {
        onUpdate({ ...found });
        unreported = false;
      }
      const gloss = await translateText(text, 'en', uiLanguage, { engine: 'offline', record: false }).then(
        (r) => r.text.trim(),
        () => null,
      );
      // A failure (model removed meanwhile) would fail for every other definition too.
      if (gloss === null || cancelled()) return;
      if (!gloss || gloss === text) continue;
      glossCache.set(text, gloss);
      found[text] = gloss;
      onUpdate({ ...found });
    }
    if (unreported && !cancelled()) onUpdate({ ...found });
  })();
}

/* ------------------------------------------------------------------ screen */

export default function WordScreen() {
  const params = useLocalSearchParams<{ word?: string | string[]; lang?: string | string[] }>();
  const target = useAppState((s) => s.target);
  const word = cleanWord(first(params.word));
  const requested = first(params.lang);
  // A link without a (valid) language looks the word up in the language the user translates into.
  const lang = requested && isLanguageCode(requested) ? requested : target;

  if (!word) {
    return (
      <Screen sheet edges={['bottom']}>
        <ModalHeader title={t('dictionary')} sheet />
        <EmptyState icon="book" title={t('wordMissing')} message={t('tapWordHint')} action={t('close')} onAction={dismiss} />
      </Screen>
    );
  }
  // Keyed so a different word starts from a clean state.
  return <WordEntry key={`${lang}:${word}`} word={word} lang={lang} />;
}

function WordEntry({ word, lang }: { word: string; lang: string }) {
  const c = useColors();
  const source = useAppState((s) => s.source);
  const target = useAppState((s) => s.target);
  const [lookup, setLookup] = useState<Lookup>(LOADING);
  const [attempt, setAttempt] = useState(0);
  const [meaning, setMeaning] = useState<string | null>(null);
  const [glosses, setGlosses] = useState<Record<string, string>>({});
  const [speaking, setSpeaking] = useState(false);
  const speech = useRef({ mine: false });

  // The word in the user's other language, translated on the device when that pair is ready.
  const into = lang === target ? (source === 'auto' ? uiLanguage : source) : target;

  // Cached copy first (instant, works offline), then the network answer replaces it.
  useEffect(() => {
    let alive = true;
    getCachedEntry<unknown>(word, lang, CACHE_NS)
      .catch(() => null)
      .then((raw) => {
        const local = parseEntry(raw);
        if (alive && local?.senses.length) setLookup((l) => (l.loading && !l.entry ? { ...l, entry: local, saved: true } : l));
      });
    fetchEntry(word, lang).then(
      (fresh) => {
        if (!alive) return;
        setLookup({ entry: fresh, loading: false, saved: false, failure: null });
        if (!fresh.senses.length) return;
        cacheEntry(word, lang, CACHE_NS, fresh)
          .then(() => {
            if (alive) setLookup((l) => (l.entry === fresh ? { ...l, saved: true } : l));
          })
          .catch(() => {});
      },
      (e: unknown) => {
        if (alive) setLookup((l) => ({ ...l, loading: false, failure: toFailure(e) }));
      },
    );
    return () => {
      alive = false;
    };
  }, [word, lang, attempt]);

  useEffect(() => {
    if (into === lang || planRoute(lang, into, ON_DEVICE_ONLY).kind !== 'offline') return;
    let alive = true;
    translateText(word, lang, into, { engine: 'offline', record: false })
      .then((r) => {
        const text = r.text.trim();
        if (alive && text && text.toLowerCase() !== word.toLowerCase()) setMeaning(text);
      })
      // Optional extra: the entry below is the real content, so a failure just leaves it out.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [word, lang, into]);

  const entry = lookup.entry;
  useEffect(() => {
    if (!entry?.senses.length || uiLanguage === 'en') return;
    if (planRoute('en', uiLanguage, ON_DEVICE_ONLY).kind !== 'offline') return;
    let alive = true;
    const texts = [...new Set(entry.senses.flatMap((s) => s.definitions.map((d) => d.text)))].slice(0, GLOSS_LIMIT);
    translateGlosses(texts, (next) => setGlosses((g) => ({ ...g, ...next })), () => !alive);
    return () => {
      alive = false;
    };
  }, [entry]);

  // Closing the sheet stops the pronunciation it started (and only that).
  useEffect(() => {
    const own = speech.current;
    return () => {
      if (own.mine) stopSpeaking();
    };
  }, []);

  const toggleSpeech = () => {
    if (speaking) {
      stopSpeaking();
      return;
    }
    speech.current.mine = true;
    setSpeaking(true);
    speak(word, lang, () => {
      speech.current.mine = false;
      setSpeaking(false);
    });
  };

  const retry = () => {
    setLookup((l) => ({ ...l, loading: true, failure: null }));
    setAttempt((n) => n + 1);
  };

  const { loading, saved, failure } = lookup;
  const groups = entry && entry.senses.length ? arrange(entry.senses, lang) : null;
  const failTitle = failure ? t(failure.offline ? 'dictionaryOffline' : 'dictionaryFailed') : null;
  const notice = groups || loading ? null : (failTitle ?? t('noDefinitions'));

  // Android reads the EmptyState through its live region; iOS needs an announcement.
  useEffect(() => {
    if (notice && Platform.OS === 'ios') announce(notice);
  }, [notice]);

  const footer = [entry?.source, saved ? t('savedForOffline') : ''].filter(Boolean).join(' · ');

  return (
    <Screen sheet edges={['bottom']}>
      <ModalHeader title={t('dictionary')} subtitle={languageName(lang)} sheet />

      <View style={styles.head}>
        <View style={styles.headText}>
          <Text variant="display" language={lang} flow="ui" selectable>
            {word}
          </Text>
          {meaning ? (
            <Animated.View entering={enterFade}>
              <Text variant="title" tone="accent" language={into} flow="ui" selectable>
                {meaning}
              </Text>
            </Animated.View>
          ) : null}
        </View>
        <IconButton
          icon={speaking ? 'stop' : 'speaker'}
          label={speaking ? t('stop') : t('listen')}
          active={speaking}
          variant="tonal"
          size={48}
          onPress={toggleSpeech}
        />
      </View>

      {loading && !groups ? (
        <Card flat entering={enterDelayed} exiting={exitFade}>
          <Skeleton lines={3} height={14} color={c.textFaint} label={t('loading')} />
        </Card>
      ) : null}

      {notice && failure ? (
        <EmptyState
          icon={failure.offline ? 'cloudOff' : 'error'}
          tone={failure.offline ? 'default' : 'danger'}
          title={notice}
          message={failure.detail || undefined}
          action={t('retry')}
          actionIcon="refresh"
          onAction={retry}
        />
      ) : notice ? (
        <EmptyState icon="book" title={notice} />
      ) : null}

      {groups?.standard.map((block) => <SenseCard key={block.key} block={block} lang={lang} glosses={glosses} />)}

      {groups?.alsoIndex != null ? (
        <Animated.View entering={listItem(groups.alsoIndex)} layout={layoutTransition}>
          <Text variant="eyebrow" tone="muted" heading>
            {t('alsoUsedIn')}
          </Text>
        </Animated.View>
      ) : null}

      {groups?.dialects.map((group) => (
        <Animated.View key={group.name} layout={layoutTransition} style={styles.group}>
          <DialectChip label={group.label} index={group.index} />
          {group.senses.map((block) => (
            <SenseCard key={block.key} block={block} lang={lang} glosses={glosses} />
          ))}
        </Animated.View>
      ))}

      {groups && footer ? (
        <Animated.View entering={enterFade} layout={layoutTransition}>
          <Text variant="caption" tone="muted">
            {footer}
          </Text>
        </Animated.View>
      ) : null}
    </Screen>
  );
}

function SenseCard({ block, lang, glosses }: { block: SenseBlock; lang: string; glosses: Record<string, string> }) {
  const { sense, index, variety } = block;
  const pos = partOfSpeechLabel(sense.partOfSpeech);
  return (
    <Card entering={listItem(index)} layout={layoutTransition} style={styles.sense}>
      {pos || variety ? (
        <View style={styles.senseHead}>
          {pos ? (
            <Text variant="eyebrow" tone="accent">
              {pos}
            </Text>
          ) : null}
          {variety ? (
            <Text variant="caption" tone="muted" style={styles.shrink}>
              {variety}
            </Text>
          ) : null}
        </View>
      ) : null}
      {sense.definitions.map((d, j) => {
        const gloss = glosses[d.text];
        return (
          <View key={j} style={styles.definition}>
            {/* Wiktionary definitions are English whatever the word's language. */}
            <Text variant="body" language="en">{`${j + 1}. ${d.text}`}</Text>
            {gloss ? (
              <Animated.View entering={enterFade}>
                <Text variant="body" tone="accent" language={uiLanguage}>
                  {gloss}
                </Text>
              </Animated.View>
            ) : null}
            {d.examples.map((example, k) => (
              <Text key={k} variant="caption" tone="muted" language={lang}>
                {quote(example, lang)}
              </Text>
            ))}
          </View>
        );
      })}
    </Card>
  );
}

/** Heads a dialect's senses; a screen-reader heading so each dialect is one swipe away. */
function DialectChip({ label, index }: { label: string; index: number }) {
  const c = useColors();
  return (
    <Animated.View entering={listItem(index)} style={[styles.chip, { backgroundColor: c.accentSoft }]}>
      <Icon name="globe" size={iconSize.sm} color={c.accent} />
      <Text variant="label" tone="accent" heading style={styles.shrink}>
        {label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  headText: { flex: 1, minWidth: 0, gap: space.xs },
  sense: { gap: space.md },
  senseHead: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: space.sm, rowGap: space.xs },
  definition: { gap: space.xs },
  group: { gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    minHeight: 28,
    maxWidth: '100%',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  shrink: { flexShrink: 1 },
});
