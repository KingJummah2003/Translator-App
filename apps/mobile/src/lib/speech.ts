import { getLocales, type Locale } from 'expo-localization';
import { useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule as Recognizer,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionOptions,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { getLanguage } from '@translator/shared';
import { getState } from './store';

/**
 * Speech to text and text to speech.
 *
 * One controller owns the native recognizer for the whole app. Screens stay mounted under the
 * tab bar, so several useDictation() hooks exist at once; the controller listens to the native
 * events once and hands them to the hook that started the current session. Every way a session
 * can end (final result, silence, error, stop, unmount, blur, the app going to the background,
 * the native side never answering) returns to 'idle' with at most one SpeechError.
 *
 * Recognition runs on the device when the phone has a model for the language, otherwise on the
 * phone's own speech service (Apple or Google). We never record or upload audio ourselves.
 */

// ---------------------------------------------------------------------------------------------
// Errors

/** Stable codes; screens turn them into text with errorMessage() from '@/lib/errors'. */
export type SpeechErrorCode =
  | 'permission' // microphone or speech recognition not granted (see SpeechError.permissionBlocked)
  | 'unavailable' // no speech service, Siri & Dictation off, or the recognizer failed to load
  | 'language-not-supported' // no recognizer for this language on this device
  | 'no-speech' // nothing was heard
  | 'network' // the online recognizer could not be reached
  | 'busy' // the recognizer or the microphone is in use (also a call or Siri interrupting)
  | 'timeout' // the native side stopped answering
  | 'audio-capture' // the microphone could not be opened
  | 'unknown';

/** @deprecated Use SpeechErrorCode. */
export type DictationErrorCode = SpeechErrorCode;

export class SpeechError extends Error {
  override readonly name = 'SpeechError';

  constructor(
    readonly code: SpeechErrorCode,
    /** The app language being dictated ('auto' allowed), for messages like "can't recognize {lang}". */
    readonly language?: string,
    /** Permission was denied for good: only the Settings app can change it. */
    readonly permissionBlocked = false,
  ) {
    super(code);
  }
}

export function isSpeechError(e: unknown): e is SpeechError {
  return e instanceof SpeechError;
}

export type DictationPhase = 'idle' | 'preparing' | 'listening' | 'stopping';

const PERMISSION_TIMEOUT_MS = 12_000; // counted only while the app is in the foreground
const QUERY_TIMEOUT_MS = 3_000; // permission status, supported locales, voices
const LOCALES_WAIT_MS = 800; // Android: a start goes on without the on-device list after this
const START_TIMEOUT_MS = 8_000; // start() → 'start' or 'error'
const STOP_TIMEOUT_MS = 4_000; // stop() → 'end'
const ABORT_TIMEOUT_MS = 1_500; // abort(), or an error → 'end'
const MAX_SESSION_MS = 60_000; // one utterance
const NO_SPEECH_HINT_MS = 4_000; // the "didn't catch that" hint clears itself

// ---------------------------------------------------------------------------------------------
// Store read by the hooks

interface Snapshot {
  owner: string | null;
  tag: string;
  phase: DictationPhase;
  partial: string;
  available: boolean;
  /** iOS: the recognizer's locales once known. null while unknown, and always on Android. */
  locales: readonly string[] | null;
  errors: Readonly<Record<string, SpeechError>>;
}

let snapshot: Snapshot = { owner: null, tag: '', phase: 'idle', partial: '', available: true, locales: null, errors: {} };
const storeListeners = new Set<() => void>();

function update(patch: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...patch };
  storeListeners.forEach((l) => l());
}

function withError(owner: string, error: SpeechError | null): Record<string, SpeechError> {
  const errors: Record<string, SpeechError> = { ...snapshot.errors };
  if (error) errors[owner] = error;
  else delete errors[owner];
  return errors;
}

const idle = { owner: null, tag: '', phase: 'idle', partial: '' } as const;

function subscribeStore(listener: () => void): () => void {
  subscribeNative();
  prewarm();
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

const getSnapshot = (): Snapshot => snapshot;

// ---------------------------------------------------------------------------------------------
// Small helpers

function withTimeout<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise((resolve) => {
    const id = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(id);
        resolve(value);
      },
      () => {
        clearTimeout(id);
        resolve(fallback);
      },
    );
  });
}

/** Like withTimeout, but the clock only runs while the app is active, so a system permission
 * prompt the user is still reading never times out; a request that never shows a prompt does. */
function withForegroundTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let left = ms;
    let last = Date.now();
    const tick = setInterval(() => {
      const now = Date.now();
      if (AppState.currentState === 'active') left -= now - last;
      last = now;
      if (left <= 0) done(null);
    }, 250);
    const done = (value: T | null) => {
      clearInterval(tick);
      resolve(value);
    };
    promise.then(done, () => done(null));
  });
}

/** Runs a native call that may throw synchronously (or return a rejected promise). */
function attempt<T>(fn: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(fn);
}

function call<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// Device capabilities (cached: on iOS each native check builds an SFSpeechRecognizer on the JS thread)

let availableCache: boolean | null = null;
let onDeviceCache: boolean | null = null;
let voiceList: Promise<string[] | null> | null = null; // text to speech, iOS

/** Whether this phone has any speech recognizer at all. Per language, see dictationSupported(). */
function recognitionAvailable(): boolean {
  if (availableCache === null) {
    // Android: false when no RecognitionService is installed or visible to the app.
    // iOS always has the Speech framework; isRecognitionAvailable() there only describes the
    // phone's own language right now, so languages are judged by the supported-locales list.
    availableCache =
      Platform.OS === 'android'
        ? call(() => Recognizer.isRecognitionAvailable(), false) ||
          call(() => Recognizer.getSpeechRecognitionServices(), [] as string[]).length > 0
        : snapshot.locales === null || snapshot.locales.length > 0;
    if (snapshot.available !== availableCache) update({ available: availableCache });
  }
  return availableCache;
}

/** Device-wide, not per language: iOS checks the phone's own language, Android only says that
 * an on-device service exists. plan() decides per language. The first iOS call takes ~350 ms. */
function onDeviceSupported(): boolean {
  onDeviceCache ??= call(() => Recognizer.supportsOnDeviceRecognition(), false);
  return onDeviceCache;
}

interface LocaleList {
  all: string[];
  installed: string[];
}

let localeList: Promise<LocaleList | null> | null = null;

function supportedLocales(): Promise<LocaleList | null> {
  // Android's checkRecognitionSupport() can call neither of its callbacks, so this needs a timeout.
  localeList ??= withTimeout(
    attempt(() => Recognizer.getSupportedLocales({})).then((r) => ({ all: r.locales ?? [], installed: r.installedLocales ?? [] })),
    QUERY_TIMEOUT_MS,
    null,
  ).then((list) => {
    if (Platform.OS === 'ios') {
      if (!list) localeList = null; // try again next time; Android keeps the miss until the next foreground
      else {
        availableCache = list.all.length > 0;
        update({ locales: list.all, available: availableCache });
      }
    }
    return list;
  });
  return localeList;
}

// Looked up once the first screen with dictation mounts, so the first tap doesn't wait for it.
let prewarmed = false;
function prewarm(): void {
  if (prewarmed) return;
  prewarmed = true;
  setTimeout(() => {
    recognitionAvailable();
    void supportedLocales();
  }, 1_500);
}

// ---------------------------------------------------------------------------------------------
// Languages and dialects

const norm = (tag: string) => tag.replace(/_/g, '-').toLowerCase();
// Script-tagged names used by expo-localization (iOS) and by Google's on-device service.
const ALIASES: Record<string, string> = {
  'zh-hans-cn': 'zh-cn',
  'zh-hant-tw': 'zh-tw',
  'zh-hant-hk': 'zh-hk',
  'cmn-hans-cn': 'zh-cn',
  'cmn-hant-tw': 'zh-tw',
  'yue-hant-hk': 'zh-hk',
};
// Legacy and alternative language subtags that name the same app language.
const SAME_LANGUAGE: Record<string, string> = { iw: 'he', in: 'id', ji: 'yi', jw: 'jv', fil: 'tl', nb: 'no', cmn: 'zh' };
const canonical = (tag: string) => ALIASES[norm(tag)] ?? norm(tag);
const baseOf = (tag: string) => {
  const base = canonical(tag).split('-')[0] ?? '';
  return SAME_LANGUAGE[base] ?? base;
};
// Script matters more than region here: never swap one variant for another.
const SCRIPT_SENSITIVE = new Set(['zh', 'sr', 'pa', 'uz', 'az', 'mni']);

/**
 * Regions with their own variety of a language, used when the phone's region is one of them but
 * its language isn't (an English-language phone in Kuwait still points to Gulf Arabic). Keyed by
 * the language subtag of the default speech locale.
 */
const REGIONS: Record<string, readonly string[]> = {
  ar: ['AE', 'BH', 'DZ', 'EG', 'IQ', 'JO', 'KW', 'LB', 'LY', 'MA', 'OM', 'PS', 'QA', 'SA', 'SD', 'SY', 'TN', 'YE'],
  en: ['AU', 'CA', 'GB', 'GH', 'IE', 'IN', 'KE', 'NG', 'NZ', 'PH', 'PK', 'SG', 'TZ', 'US', 'ZA'],
  es: ['AR', 'BO', 'CL', 'CO', 'CR', 'DO', 'EC', 'ES', 'GT', 'HN', 'MX', 'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'UY', 'VE'],
  fr: ['BE', 'CA', 'CH', 'FR'],
  pt: ['BR', 'PT'],
  de: ['AT', 'CH', 'DE'],
  nl: ['BE', 'NL'],
  it: ['CH', 'IT'],
  sw: ['KE', 'TZ'],
  ta: ['IN', 'LK', 'MY', 'SG'],
  bn: ['BD', 'IN'],
  ur: ['IN', 'PK'],
};

function deviceLocales(): readonly Locale[] {
  return call<readonly Locale[]>(() => getLocales(), []);
}

/** The language subtag of the language's default speech locale ('fil' for tl, 'nb' for no). */
function speechLanguage(code: string): string {
  const tag = getLanguage(code)?.speech ?? code;
  return (tag.split('-')[0] ?? tag).toLowerCase();
}

/** The dialect the user picked in settings, if it belongs to this language. */
function chosenDialect(code: string): string | undefined {
  const tag = call(() => getState().settings.dialects[code], undefined);
  return tag && baseOf(tag) === baseOf(code) ? tag : undefined;
}

/**
 * Locale tags for a language, best first: the dialect picked in settings, then the phone's own
 * regional variety (ar-KW on a Kuwaiti phone, es-MX on a Mexican one, pt-PT, fr-CA…), then the
 * language's default, then the bare code.
 */
function localeCandidates(code: string): string[] {
  const out: string[] = [];
  const add = (tag: string | null | undefined) => {
    if (tag && !out.some((o) => canonical(o) === canonical(tag))) out.push(tag);
  };
  const device = deviceLocales();

  if (code === 'auto') {
    // Recognizers can't detect the language: use the phone's.
    const first = device[0];
    add(first?.languageTag);
    if (first?.languageCode) {
      add(getLanguage(first.languageCode)?.speech);
      add(first.languageCode);
    }
    add('en-US');
    return out;
  }

  add(chosenDialect(code));
  const lang = speechLanguage(code);
  if (!code.includes('-') && !SCRIPT_SENSITIVE.has(baseOf(lang))) {
    for (const l of device) {
      if (l.regionCode && l.languageCode && baseOf(l.languageCode) === baseOf(lang)) add(`${lang}-${l.regionCode.toUpperCase()}`);
    }
    const region = device[0]?.regionCode?.toUpperCase();
    if (region && REGIONS[lang]?.includes(region)) add(`${lang}-${region}`);
  }
  add(getLanguage(code)?.speech);
  add(code);
  return out;
}

function matchLocale(tags: readonly string[], list: readonly string[]): string | undefined {
  for (const tag of tags) {
    const hit = list.find((l) => canonical(l) === canonical(tag));
    if (hit) return hit;
  }
  // Same language, another region: e.g. Kuwaiti Arabic → ar-SA, Nigerian English → en-US.
  for (const tag of tags) {
    const base = baseOf(tag);
    if (SCRIPT_SENSITIVE.has(base)) continue;
    const hit = list.find((l) => baseOf(l) === base);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The speech locale (dialect) used for a language: the user's choice, else the phone's region
 * when it fits the language (ar-KW on a Kuwaiti phone, es-MX on a Mexican one), else the
 * language's default (ar-SA, es-ES). 'auto' gives the phone's own locale.
 */
export function speechLocale(code: string): string {
  return localeCandidates(code)[0] ?? 'en-US';
}

/**
 * Speech locales a dialect picker can offer for a language, the default first. iOS lists what its
 * recognizer supports; Android's online recognizer isn't listed anywhere, so it gets the known
 * regional varieties plus any on-device ones. Empty when the language can't be dictated (iOS).
 */
export async function speechDialects(code: string): Promise<string[]> {
  const fallback = getLanguage(code)?.speech;
  if (!fallback) return [];
  const lang = speechLanguage(code);
  if (code.includes('-') || SCRIPT_SENSITIVE.has(baseOf(lang))) return [fallback];
  const out: string[] = [];
  const add = (tag: string) => {
    if (!out.some((o) => canonical(o) === canonical(tag))) out.push(tag);
  };
  const list = await supportedLocales();
  const sameLanguage = (list?.all ?? []).filter((l) => baseOf(l) === baseOf(lang));
  if (Platform.OS === 'ios' && list?.all.length) {
    const exact = sameLanguage.find((l) => canonical(l) === canonical(fallback));
    if (exact) add(exact);
    sameLanguage.forEach(add);
    return out;
  }
  add(fallback);
  (REGIONS[lang] ?? []).forEach((r) => add(`${lang}-${r}`));
  sameLanguage.forEach(add);
  return out;
}

/** False when this phone is known not to recognize speech in this language. */
function dictationSupported(code: string, available: boolean, locales: readonly string[] | null): boolean {
  if (!available) return false;
  if (Platform.OS !== 'ios' || !locales?.length) return true;
  return !!matchLocale(localeCandidates(code), locales);
}

interface Attempt {
  locale: string;
  onDevice: boolean;
}

/** The recognizer configurations to try, in order. Empty when the language can't be dictated. */
async function plan(code: string): Promise<Attempt[]> {
  const tags = localeCandidates(code);
  if (!tags.length) return [];

  if (Platform.OS === 'ios') {
    // The iOS module only accepts identifiers from SFSpeechRecognizer.supportedLocales()
    // (exact match: 'ar-KW' and 'ar' are refused, 'ar-SA' works).
    const list = await supportedLocales();
    if (!list?.all.length) return tags.slice(0, 3).map((locale) => ({ locale, onDevice: false }));
    const locale = matchLocale(tags, list.all);
    if (!locale) return [];
    // The module ignores requiresOnDeviceRecognition for locales without an on-device model;
    // if loading the model fails (always in the Simulator) the next attempt uses Apple's server.
    return onDeviceSupported() ? [{ locale, onDevice: true }, { locale, onDevice: false }] : [{ locale, onDevice: false }];
  }

  // Android: getSupportedLocales() describes the on-device service only (it has no Arabic, for
  // example, which Google's online recognizer handles), so it picks on-device recognition but
  // never refuses a language. installedLocales is empty until the user downloads a model.
  const attempts: Attempt[] = [];
  const list = await withTimeout(supportedLocales(), LOCALES_WAIT_MS, null);
  const installed = list?.installed.length && onDeviceSupported() ? matchLocale(tags, list.installed) : undefined;
  if (installed) attempts.push({ locale: installed, onDevice: true });
  // Online: the preferred dialect, then the language's default (ar-KW, then ar-SA).
  const online: string[] = [];
  for (const tag of [tags[0], code === 'auto' ? undefined : getLanguage(code)?.speech, ...tags]) {
    if (tag && online.length < 2 && !online.some((o) => canonical(o) === canonical(tag))) online.push(tag);
  }
  online.forEach((locale) => attempts.push({ locale, onDevice: false }));
  return attempts;
}

// ---------------------------------------------------------------------------------------------
// Permissions

type PermissionOutcome = 'granted' | 'denied' | 'blocked';
type PermissionLike = { granted: boolean; canAskAgain?: boolean; restricted?: boolean } | null;

function outcome(p: PermissionLike): PermissionOutcome {
  if (p?.granted) return 'granted';
  if (p && (p.canAskAgain === false || p.restricted)) return 'blocked';
  return 'denied';
}

let permissionRequest: Promise<PermissionOutcome> | null = null;

/**
 * Asks for one permission at a time instead of requestPermissionsAsync(), which on iOS chains
 * SFSpeechRecognizer.requestAuthorization and requestRecordPermission inside one native call: if
 * either callback is lost the promise never settles. Shared, so two taps or two screens never
 * stack prompts.
 */
function ensurePermissions(): Promise<PermissionOutcome> {
  permissionRequest ??= (async (): Promise<PermissionOutcome> => {
    const current = await withTimeout(attempt(() => Recognizer.getPermissionsAsync()), QUERY_TIMEOUT_MS, null);
    if (current?.granted) return 'granted';
    if (outcome(current) === 'blocked') return 'blocked';

    const mic = await withForegroundTimeout(attempt(() => Recognizer.requestMicrophonePermissionsAsync()), PERMISSION_TIMEOUT_MS);
    if (!mic?.granted) {
      return outcome(mic ?? (await withTimeout(attempt(() => Recognizer.getMicrophonePermissionsAsync()), QUERY_TIMEOUT_MS, null)));
    }
    if (Platform.OS === 'ios') {
      // Android has no separate speech permission (the module answers granted).
      const speech = await withForegroundTimeout(attempt(() => Recognizer.requestSpeechRecognizerPermissionsAsync()), PERMISSION_TIMEOUT_MS);
      if (!speech?.granted) {
        return outcome(speech ?? (await withTimeout(attempt(() => Recognizer.getSpeechRecognizerPermissionsAsync()), QUERY_TIMEOUT_MS, null)));
      }
    }
    return 'granted';
  })().finally(() => {
    permissionRequest = null;
  });
  return permissionRequest;
}

// ---------------------------------------------------------------------------------------------
// Sessions

interface Session {
  owner: string;
  tag: string;
  languageCode: string;
  attempts: Attempt[];
  index: number;
  started: boolean; // native 'start' seen for the current attempt
  heard: boolean; // any transcript in this session
  delivered: string; // last final transcript handed to the screen
  noMatch: boolean;
  error: ExpoSpeechRecognitionErrorEvent | null; // for the current attempt
  retry: 'next' | 'same' | null;
  busyRetried: boolean;
  userStopped: boolean;
  cancelled: boolean; // ended on purpose: finish without an error and deliver nothing more
  failure: SpeechErrorCode | null; // set by a watchdog
}

const owners = new Map<string, (text: string, tag: string) => void>();
let session: Session | null = null;
let startToken = 0; // bumped by every start/cancel; a pending start that sees a newer token gives up
let nativeActive = false; // Recognizer.start() was called and its 'end' has not arrived yet
let checkedLeftover = false; // looked for a native session left running by a JS reload
let draining: (() => void) | null = null; // set while waiting for an aborted session's 'end'
let timer: ReturnType<typeof setTimeout> | null = null;
let audioSessionDirty = false; // iOS: the recognizer configured the shared session since the last restore

function clearTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function arm(ms: number, fn: () => void): void {
  clearTimer();
  timer = setTimeout(() => {
    timer = null;
    fn();
  }, ms);
}

function abortNative(): void {
  call(() => Recognizer.abort(), undefined);
}

/** End a session whose 'end' event never came. */
function forceEnd(s: Session): void {
  if (session !== s) return;
  nativeActive = false;
  finalize(s);
}

function watchdog(s: Session, code: SpeechErrorCode): void {
  if (session !== s) return;
  s.failure = code;
  abortNative();
  arm(ABORT_TIMEOUT_MS, () => forceEnd(s));
}

function nativeStart(s: Session): void {
  const current = s.attempts[s.index];
  if (!current) return finish(s, 'language-not-supported');
  s.started = false;
  s.error = null;
  s.retry = null;
  s.noMatch = false;
  const options: ExpoSpeechRecognitionOptions = {
    lang: current.locale,
    interimResults: true,
    continuous: false,
    maxAlternatives: 1,
    addsPunctuation: true,
    requiresOnDeviceRecognition: current.onDevice,
    iosTaskHint: 'dictation',
  };
  nativeActive = true;
  if (Platform.OS === 'ios') audioSessionDirty = true;
  arm(START_TIMEOUT_MS, () => watchdog(s, 'timeout'));
  try {
    Recognizer.start(options);
  } catch {
    nativeActive = false;
    finish(s, 'unknown');
  }
}

/** Make sure no native session is running before a new one starts; its late 'error'/'end' events
 * would otherwise be taken for the new session's. */
async function drainNative(): Promise<void> {
  if (!nativeActive) {
    if (checkedLeftover) return;
    checkedLeftover = true;
    // A JS reload can leave the native recognizer running without any record of it here.
    const state = await withTimeout(attempt(() => Recognizer.getStateAsync()), 400, 'inactive' as const);
    if (state === 'inactive') return;
  }
  await new Promise<void>((resolve) => {
    const id = setTimeout(() => {
      draining = null;
      nativeActive = false;
      resolve();
    }, ABORT_TIMEOUT_MS);
    draining = () => {
      clearTimeout(id);
      resolve();
    };
    abortNative();
  });
}

const RETRY_WITH_NEXT = new Set(['language-not-supported', 'service-not-allowed', 'client']);
const failedToLoad = (e: ExpoSpeechRecognitionErrorEvent) =>
  // iOS reports kLSRErrorDomain 300 ("Failed to initialize recognizer") and missing assets as
  // 'audio-capture'; it means the model could not load, not that the microphone failed.
  e.error === 'audio-capture' && /initiali[sz]e|asset/i.test(e.message ?? '');

function mapError(e: ExpoSpeechRecognitionErrorEvent): SpeechErrorCode {
  // 'too-many-requests' is sent by Android but missing from the module's type.
  switch (e.error as string) {
    case 'not-allowed':
      return 'permission';
    case 'service-not-allowed':
      return 'unavailable';
    case 'language-not-supported':
      return 'language-not-supported';
    case 'network':
      return 'network';
    case 'no-speech':
    case 'speech-timeout':
      return 'no-speech';
    case 'busy':
    case 'too-many-requests':
    case 'interrupted': // a call, Siri or an alarm took the audio session
      return 'busy';
    case 'audio-capture':
      return failedToLoad(e) ? 'unavailable' : 'audio-capture';
    case 'client':
      return recognitionAvailable() ? 'unknown' : 'unavailable';
    default:
      return 'unknown';
  }
}

function finalize(s: Session): void {
  clearTimer();
  if (s.cancelled) return finish(s, null);
  if (s.failure) return finish(s, s.failure);
  if (s.retry && !s.userStopped) {
    const next = s.retry === 'next' ? s.index + 1 : s.index;
    if (s.attempts[next]) {
      s.index = next;
      // Wait for the recognizer to release the microphone (Android answers 'busy' otherwise).
      setTimeout(
        () => {
          if (session === s && !s.cancelled) nativeStart(s);
        },
        s.retry === 'same' ? 500 : 150,
      );
      return;
    }
  }
  if (s.error) return finish(s, mapError(s.error));
  if (!s.heard && !s.userStopped && (s.noMatch || s.started)) return finish(s, 'no-speech');
  finish(s, null);
}

function finish(s: Session, code: SpeechErrorCode | null): void {
  clearTimer();
  if (session === s) session = null;
  const error = code ? new SpeechError(code, s.languageCode) : null;
  const errors = withError(s.owner, error);
  update(snapshot.owner === s.owner ? { ...idle, errors } : { errors });
  if (code === 'no-speech') clearErrorLater(s.owner, error);
  if (code === 'permission') void refinePermissionError(s.owner, s.languageCode);
  restoreAudioSession();
}

function clearErrorLater(owner: string, error: SpeechError | null): void {
  setTimeout(() => {
    if (error && snapshot.errors[owner] === error) update({ errors: withError(owner, null) });
  }, NO_SPEECH_HINT_MS);
}

/** A 'not-allowed' from the recognizer: find out whether asking again can still help. */
async function refinePermissionError(owner: string, languageCode: string): Promise<void> {
  const p = await withTimeout(attempt(() => Recognizer.getPermissionsAsync()), QUERY_TIMEOUT_MS, null);
  if (outcome(p) === 'blocked' && snapshot.errors[owner]?.code === 'permission') {
    update({ errors: withError(owner, new SpeechError('permission', languageCode, true)) });
  }
}

// iOS audio session --------------------------------------------------------------------------

let restoreTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * iOS: the recognizer leaves the shared audio session active in playAndRecord + measurement mode
 * (measurement turns playback down and keeps other apps' audio interrupted). Hand it back once
 * nothing is listening. Both calls throw while audio I/O is still running; then we retry.
 */
function restoreAudioSessionNow(): boolean {
  if (Platform.OS !== 'ios' || !audioSessionDirty) return true;
  if (session || nativeActive) return false;
  try {
    Recognizer.setAudioSessionActiveIOS(false, { notifyOthersOnDeactivation: true });
    // mode must be explicit: the module's SetCategoryOptions default is 'measurement'.
    Recognizer.setCategoryIOS({ category: 'soloAmbient', categoryOptions: [], mode: 'default' });
    audioSessionDirty = false;
    return true;
  } catch {
    return false;
  }
}

function restoreAudioSession(retry = 0): void {
  if (Platform.OS !== 'ios') return;
  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = setTimeout(
    () => {
      restoreTimer = null;
      if (!restoreAudioSessionNow() && retry < 3 && !session && !nativeActive) restoreAudioSession(retry + 1);
    },
    300 * (retry + 1),
  );
}

// Native events -------------------------------------------------------------------------------

function onStart(): void {
  const s = session;
  if (draining || !s || s.cancelled) return;
  s.started = true;
  arm(MAX_SESSION_MS, () => {
    if (session === s) stopSession(s.owner);
  });
  if (snapshot.owner === s.owner) update({ phase: s.userStopped ? 'stopping' : 'listening' });
}

function onResult(e: ExpoSpeechRecognitionResultEvent): void {
  const s = session;
  if (draining || !s || s.cancelled) return;
  // iOS 18+ prefixes later results with a space; Android sends alternatives we don't use.
  const text = (e.results[0]?.transcript ?? '').trim();
  if (!text) return;
  s.heard = true;
  if (!e.isFinal) {
    if (snapshot.owner === s.owner) update({ partial: text });
    return;
  }
  update({ partial: '' });
  if (text === s.delivered) return;
  s.delivered = text;
  try {
    owners.get(s.owner)?.(text, s.tag);
  } catch (err) {
    console.error('dictation onFinal failed', err);
  }
}

function onNoMatch(): void {
  if (!draining && session) session.noMatch = true;
}

function onError(e: ExpoSpeechRecognitionErrorEvent): void {
  const s = session;
  if (draining || !s) return;
  if (e.error === 'aborted') return; // our own abort(); 'end' follows
  s.error = e;
  if (!s.heard) {
    const code = e.error as string;
    if ((code === 'busy' || code === 'too-many-requests') && !s.busyRetried) {
      s.busyRetried = true;
      s.retry = 'same';
    } else if (RETRY_WITH_NEXT.has(code) || failedToLoad(e)) {
      s.retry = 'next';
    }
  }
  // Both platforms send 'end' right after an error; don't wait for it forever.
  arm(ABORT_TIMEOUT_MS, () => forceEnd(s));
}

function onEnd(): void {
  if (draining) {
    const done = draining;
    draining = null;
    nativeActive = false;
    done();
    return;
  }
  const s = session;
  if (!s) {
    nativeActive = false;
    return;
  }
  // An 'end' before this attempt's 'start' and without an error belongs to an earlier native
  // session (one left running across a reload, or a second 'end' after an abort). The start
  // watchdog covers the case where ours never starts.
  if (!s.started && !s.error && !s.failure && !s.cancelled) return;
  nativeActive = false;
  finalize(s);
}

let appState: AppStateStatus = AppState.currentState;

function onAppState(next: AppStateStatus): void {
  if (next === 'active' && appState === 'background') {
    // Dictation settings, speech services, models or voices may have changed meanwhile.
    availableCache = null;
    onDeviceCache = null;
    voiceList = null;
    if (Platform.OS === 'android') {
      localeList = null;
      recognitionAvailable();
    }
  } else if (next === 'background' && session) {
    // Not during 'preparing': Android reports 'background' while its permission dialog is up.
    cancelSession(session.owner);
  }
  appState = next;
}

type Subscription = { remove(): void };
const g = globalThis as { __dictationSubscriptions?: Subscription[] };
let subscribed = false;

function subscribeNative(): void {
  if (subscribed) return;
  subscribed = true;
  // Fast Refresh re-runs this module: drop the previous copy's listeners.
  g.__dictationSubscriptions?.forEach((sub) => sub.remove());
  g.__dictationSubscriptions = [
    Recognizer.addListener('start', onStart),
    Recognizer.addListener('result', onResult),
    Recognizer.addListener('nomatch', onNoMatch),
    Recognizer.addListener('error', onError),
    Recognizer.addListener('end', onEnd),
    AppState.addEventListener('change', onAppState),
  ];
}

// Public operations -----------------------------------------------------------------------------

async function stopSpeakingFirst(): Promise<void> {
  const job = ttsJob;
  if (job) finishTts(job);
  const speaking = !!job || (await withTimeout(attempt(() => Speech.isSpeakingAsync()), 300, false));
  if (!speaking) return;
  await stopTts();
  // Let the synthesizer release the audio route before the recognizer reconfigures it.
  await delay(150);
}

async function startSession(owner: string, languageCode: string, tag: string): Promise<void> {
  subscribeNative();
  const token = ++startToken;
  clearTimer();
  const running = session;
  if (running) {
    // Another screen (or this one) is listening: stop it now; drainNative() waits for its 'end'.
    running.cancelled = true;
    session = null;
    abortNative();
  }
  update({ owner, tag, phase: 'preparing', partial: '', errors: withError(owner, null) });

  const fail = (code: SpeechErrorCode, blocked = false) => {
    if (token !== startToken) return;
    update({ ...idle, errors: withError(owner, new SpeechError(code, languageCode, blocked)) });
    restoreAudioSession(); // a session this start replaced may have left it configured
  };

  try {
    await stopSpeakingFirst();
    if (token !== startToken) return;

    const permission = await ensurePermissions();
    if (token !== startToken) return;
    if (permission !== 'granted') return fail('permission', permission === 'blocked');

    if (!recognitionAvailable()) return fail('unavailable');

    const attempts = await plan(languageCode);
    if (token !== startToken) return;
    if (!attempts.length) return fail('language-not-supported');

    await drainNative();
    if (token !== startToken) return;

    const s: Session = {
      owner,
      tag,
      languageCode,
      attempts,
      index: 0,
      started: false,
      heard: false,
      delivered: '',
      noMatch: false,
      error: null,
      retry: null,
      busyRetried: false,
      userStopped: false,
      cancelled: false,
      failure: null,
    };
    session = s;
    nativeStart(s);
  } catch (err) {
    console.error('dictation start failed', err);
    fail('unknown');
  }
}

/** Stop listening and keep what was said. */
function stopSession(owner: string): void {
  if (snapshot.owner !== owner) return;
  const s = session;
  if (!s) {
    // Still asking for permission or looking up the language.
    startToken++;
    update(idle);
    return;
  }
  if (s.userStopped) return;
  if (!nativeActive) {
    // Between two attempts.
    s.cancelled = true;
    return finish(s, null);
  }
  s.userStopped = true;
  update({ phase: 'stopping' });
  if (!s.started) {
    // Android ignores stop() before the recognizer is ready.
    s.cancelled = true;
    abortNative();
    arm(ABORT_TIMEOUT_MS, () => forceEnd(s));
    return;
  }
  try {
    Recognizer.stop();
  } catch {
    abortNative();
  }
  arm(STOP_TIMEOUT_MS, () => {
    if (session !== s) return;
    abortNative();
    arm(ABORT_TIMEOUT_MS, () => forceEnd(s));
  });
}

/** Stop listening and drop the session (unmount, blur, background, text to speech). */
function cancelSession(owner: string): void {
  if (snapshot.owner !== owner) return;
  const s = session;
  if (!s) {
    startToken++;
    update(idle);
    return;
  }
  s.cancelled = true;
  if (!nativeActive) return finish(s, null);
  abortNative();
  arm(ABORT_TIMEOUT_MS, () => forceEnd(s));
  update(idle);
}

function clearOwnerError(owner: string): void {
  if (snapshot.errors[owner]) update({ errors: withError(owner, null) });
}

function register(owner: string, onFinal: (text: string, tag: string) => void): () => void {
  owners.set(owner, onFinal);
  return () => {
    cancelSession(owner);
    owners.delete(owner);
    clearOwnerError(owner);
  };
}

// ---------------------------------------------------------------------------------------------
// Hook

export interface Dictation {
  /** True from the tap until the session is over (including the permission prompt). */
  listening: boolean;
  /** Words heard so far in the current utterance. */
  partial: string;
  /** Why the last session failed, until the next start (or clearError()). 'no-speech' clears itself. */
  error: SpeechErrorCode | null;
  start: (languageCode: string, tag?: string) => Promise<void>;
  /** Stop listening and keep what was heard. */
  stop: () => void;
  /** False when this phone has no usable speech recognizer. */
  available: boolean;
  phase: DictationPhase;
  /** The `tag` passed to start() while this hook's session runs, else ''. */
  tag: string;
  /** The same failure as `error`, for errorMessage(); stable until the error changes. */
  failure: SpeechError | null;
  /** The permission was denied for good: offer Settings (Linking.openSettings()). */
  permissionBlocked: boolean;
  /** Stop listening and drop what wasn't delivered yet. */
  cancel: () => void;
  clearError: () => void;
  /** False when this phone is known not to recognize this language (dim the mic). */
  canDictate: (languageCode: string) => boolean;
}

/**
 * Dictation for one screen. `onFinal` gets each final transcript with the tag given to start().
 * Listening stops when the screen unmounts or loses focus, and when the app goes to the
 * background. Call it from a screen (it uses navigation focus).
 */
export function useDictation(onFinal: (text: string, tag: string) => void): Dictation {
  const id = useId();
  const latest = useRef(onFinal);
  useEffect(() => {
    latest.current = onFinal;
  });
  useEffect(() => register(id, (text, tag) => latest.current(text, tag)), [id]);
  // Tabs stay mounted underneath each other, so leaving the screen must free the microphone.
  useFocusEffect(
    useCallback(
      () => () => {
        cancelSession(id);
        clearOwnerError(id);
      },
      [id],
    ),
  );

  const snap = useSyncExternalStore(subscribeStore, getSnapshot, getSnapshot);
  const start = useCallback((languageCode: string, tag = '') => startSession(id, languageCode, tag), [id]);
  const stop = useCallback(() => stopSession(id), [id]);
  const cancel = useCallback(() => cancelSession(id), [id]);
  const clearError = useCallback(() => clearOwnerError(id), [id]);
  const { available, locales } = snap;
  const canDictate = useCallback((languageCode: string) => dictationSupported(languageCode, available, locales), [available, locales]);

  const mine = snap.owner === id;
  const failure = snap.errors[id] ?? null;
  return {
    listening: mine && snap.phase !== 'idle',
    partial: mine ? snap.partial : '',
    error: failure?.code ?? null,
    start,
    stop,
    available,
    phase: mine ? snap.phase : 'idle',
    tag: mine ? snap.tag : '',
    failure,
    permissionBlocked: !!failure?.permissionBlocked,
    cancel,
    clearError,
    canDictate,
  };
}

// ---------------------------------------------------------------------------------------------
// Text to speech

// Android refuses longer input (TextToSpeech.getMaxSpeechInputLength(), 4000) with an error that
// never reaches a callback. iOS has no limit; it is split the same way so both behave alike.
const TTS_CHUNK_LENGTH = Math.min(3_900, Math.max(200, (Speech.maxSpeechInputLength || 4_000) - 100));
// Sentence ends (Latin, Arabic, Devanagari; CJK needs no space after), then line breaks, then
// clause marks, then any space. Text with none of these (Thai, long CJK clauses) is cut hard.
const BREAKS = [/[.!?؟।…]+["'”’»)\]]*\s+|[。！？]+[」』”’）]*/g, /\n+/g, /[,;:،؛，、]\s*/g, /\s+/g];

/** Splits text into pieces the synthesizer accepts, at the most natural break in each window. */
export function splitForSpeech(text: string, max = TTS_CHUNK_LENGTH): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const head = rest.slice(0, max);
    let cut = 0;
    for (const re of BREAKS) {
      for (const m of head.matchAll(re)) cut = Math.max(cut, (m.index ?? 0) + m[0].length);
      if (cut >= max * 0.4) break; // a break near the start would make a tiny piece
      cut = 0;
    }
    if (!cut) {
      cut = max;
      const code = head.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1; // never split a surrogate pair
    }
    const piece = rest.slice(0, cut).trim();
    if (piece) chunks.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// iOS: a separate audio session, so a recognizer's playAndRecord/measurement session can't turn
// the voice down, and other apps' audio is ducked rather than stopped.
const TTS_PLATFORM_OPTIONS: Speech.SpeechOptions = Platform.OS === 'ios' ? { useApplicationAudioSession: false } : {};

interface TtsJob {
  done?: () => void;
  finished: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

let ttsJob: TtsJob | null = null;

/** Ends a job exactly once, whichever of done/stopped/error/watchdog/stopSpeaking comes first. */
function finishTts(job: TtsJob): void {
  if (job.finished) return;
  job.finished = true;
  if (job.timer) clearTimeout(job.timer);
  if (ttsJob === job) ttsJob = null;
  try {
    job.done?.();
  } catch (err) {
    console.error('speak onDone failed', err);
  }
}

function stopTts(): Promise<void> {
  return withTimeout(attempt(() => Speech.stop()), 500, undefined);
}

/** If the synthesizer goes quiet without telling us (lost event, engine failure), end the job. */
function watchTts(job: TtsJob): void {
  let misses = 0;
  const check = async () => {
    if (job.finished) return;
    const speaking = await withTimeout(attempt(() => Speech.isSpeakingAsync()), 1_000, false);
    if (job.finished) return;
    misses = speaking ? 0 : misses + 1;
    if (misses >= 2) return finishTts(job);
    job.timer = setTimeout(() => void check(), 2_000);
  };
  // Android's engine can take a few seconds to bind the first time.
  job.timer = setTimeout(() => void check(), 5_000);
}

/** iOS: the languages that have a voice (e.g. Arabic is 'ar-001' since iOS 17, not 'ar-SA'). */
function voiceLanguages(): Promise<string[] | null> {
  voiceList ??= withTimeout(attempt(() => Speech.getAvailableVoicesAsync()), QUERY_TIMEOUT_MS, null).then((voices) => {
    const languages = voices?.map((v) => v.language).filter(Boolean) ?? [];
    if (!languages.length) voiceList = null;
    return languages.length ? languages : null;
  });
  return voiceList;
}

async function ttsLanguage(code: string): Promise<string> {
  const tags = localeCandidates(code);
  const fallback = (code === 'auto' ? tags[0] : getLanguage(code)?.speech) ?? tags[0] ?? code;
  if (Platform.OS !== 'ios') {
    // expo-speech builds a java Locale from the whole string, which only understands a bare
    // language; Android picks that language's default voice.
    return (fallback.split('-')[0] ?? fallback).toLowerCase();
  }
  // AVSpeechSynthesisVoice(language:) is nil for a locale without a voice (ar-KW, or ar-SA on
  // iOS 17+), and nil means the phone's own voice reading a foreign text.
  const voices = await withTimeout(voiceLanguages(), 600, null);
  return (voices && matchLocale(tags, voices)) ?? fallback;
}

/**
 * Reads text aloud in a language. `onDone` runs exactly once: when it finishes, is stopped,
 * fails, is replaced by another speak(), or stopSpeaking() is called. Cancels dictation first.
 */
export function speak(text: string, languageCode: string, onDone?: () => void): void {
  const previous = ttsJob;
  if (previous) finishTts(previous);
  const job: TtsJob = { done: onDone, finished: false, timer: null };
  const chunks = splitForSpeech(text);
  if (!chunks.length) {
    void stopTts();
    return finishTts(job);
  }
  ttsJob = job;
  // The recognizer must not hear us, and it holds the audio session while it runs.
  if (snapshot.owner) cancelSession(snapshot.owner);

  void (async () => {
    const [, language] = await Promise.all([stopTts(), ttsLanguage(languageCode)]);
    if (job.finished) return;
    restoreAudioSessionNow();
    for (let i = 0; i < chunks.length && !job.finished; i++) {
      const last = i === chunks.length - 1;
      try {
        Speech.speak(chunks[i] ?? '', {
          language,
          ...TTS_PLATFORM_OPTIONS,
          onDone: last ? () => finishTts(job) : undefined,
          onStopped: () => finishTts(job),
          onError: () => finishTts(job),
        });
      } catch {
        finishTts(job);
        void stopTts();
      }
    }
    if (!job.finished) watchTts(job);
  })().catch(() => finishTts(job));
}

export function stopSpeaking(): void {
  const job = ttsJob;
  if (job) finishTts(job);
  void stopTts();
}
