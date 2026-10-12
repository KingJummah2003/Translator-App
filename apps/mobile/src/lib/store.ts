import { useSyncExternalStore } from 'react';
import { isLanguageCode, type Entitlements } from '@translator/shared';
import { kvGet, kvSet } from './db';
import { uiLanguage } from './i18n';

/**
 * Small global store (no extra library). Preferences are persisted in the encrypted
 * local database; entitlements are cached from the API.
 */

export interface Settings {
  saveHistory: boolean;
  autoSpeak: boolean;
  wifiOnlyDownloads: boolean;
  appLock: boolean;
  /** Speech locale chosen per language, e.g. { ar: 'ar-EG' }. Missing means the default. */
  dialects: Record<string, string>;
}

export interface AppState {
  ready: boolean;
  source: string; // 'auto' or a language code
  target: string;
  recent: string[];
  settings: Settings;
  downloadedModels: string[];
  downloading: Record<string, number>;
  entitlements: Entitlements | null;
  /** True while a just-finished purchase waits for the server to credit it. */
  entitlementsSyncing: boolean;
}

const DEFAULT_SETTINGS: Settings = { saveHistory: true, autoSpeak: true, wifiOnlyDownloads: true, appLock: false, dialects: {} };
const DEFAULT_LANGUAGES = { source: 'auto', target: uiLanguage === 'ar' ? 'en' : 'ar' };
const RECENT_LIMIT = 8;

let state: AppState = {
  ready: false,
  ...DEFAULT_LANGUAGES,
  recent: [],
  settings: DEFAULT_SETTINGS,
  downloadedModels: [],
  downloading: {},
  entitlements: null,
  entitlementsSyncing: false,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppState<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state), () => select(state));
}

/* ------------------------------------------------------------------ persistence */

/** Saves in the background. A failed write only loses the value on the next launch. */
function persist(key: string, value: unknown): void {
  kvSet(key, value).catch(() => {});
}

function sanitizeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof Settings) => (typeof s[k] === 'boolean' ? (s[k] as boolean) : (DEFAULT_SETTINGS[k] as boolean));
  const dialects: Record<string, string> = {};
  if (s.dialects && typeof s.dialects === 'object') {
    for (const [code, tag] of Object.entries(s.dialects as Record<string, unknown>)) {
      if (typeof tag === 'string' && isLanguageCode(code)) dialects[code] = tag;
    }
  }
  return {
    saveHistory: bool('saveHistory'),
    autoSpeak: bool('autoSpeak'),
    wifiOnlyDownloads: bool('wifiOnlyDownloads'),
    appLock: bool('appLock'),
    dialects,
  };
}

/** Stored languages, dropping codes this version no longer offers. */
function sanitizeLanguages(raw: unknown): { source: string; target: string } {
  const l = (raw && typeof raw === 'object' ? raw : {}) as { source?: unknown; target?: unknown };
  const source = typeof l.source === 'string' && (l.source === 'auto' || isLanguageCode(l.source)) ? l.source : DEFAULT_LANGUAGES.source;
  const target = typeof l.target === 'string' && isLanguageCode(l.target) ? l.target : DEFAULT_LANGUAGES.target;
  return source === target ? { source: 'auto', target } : { source, target };
}

/** Loads saved preferences. Never rejects: with an unreadable database the app starts with defaults. */
export async function loadPersisted(): Promise<void> {
  let saved: Partial<AppState> = {};
  try {
    const [langs, recent, settings] = await Promise.all([
      kvGet<unknown>('languages', null),
      kvGet<unknown>('recent', []),
      kvGet<unknown>('settings', {}),
    ]);
    saved = {
      ...sanitizeLanguages(langs),
      recent: Array.isArray(recent) ? recent.filter((c): c is string => typeof c === 'string' && isLanguageCode(c)).slice(0, RECENT_LIMIT) : [],
      settings: sanitizeSettings(settings),
    };
  } catch {
    // Defaults it is.
  }
  setState({ ...saved, ready: true });
}

/** Back to defaults in memory too (after the local data was wiped). */
export function resetPreferences(): void {
  setState({ ...DEFAULT_LANGUAGES, recent: [], settings: DEFAULT_SETTINGS });
}

/* ------------------------------------------------------------------ languages */

export function setLanguages(source: string, target: string): void {
  const recent = [target, source, ...state.recent]
    .filter((c, i, all) => c !== 'auto' && all.indexOf(c) === i)
    .slice(0, RECENT_LIMIT);
  setState({ source, target, recent });
  persist('languages', { source, target });
  persist('recent', recent);
}

/** A sensible language that is not `code`: the preferred one, a recent one, the UI language. */
function otherThan(code: string, preferred?: string): string {
  const candidates = [preferred, ...state.recent, uiLanguage, 'en', 'ar'];
  return candidates.find((c): c is string => !!c && c !== 'auto' && c !== code && isLanguageCode(c)) ?? 'en';
}

/**
 * Picks a language for one side, as the language sheet does. Choosing the language already
 * on the other side swaps the pair instead of making both sides the same.
 */
export function chooseLanguage(side: 'source' | 'target', code: string): void {
  const { source, target } = state;
  if (side === 'source') {
    if (code !== 'auto' && !isLanguageCode(code)) return;
    setLanguages(code, code === target ? otherThan(code, source) : target);
  } else {
    if (!isLanguageCode(code)) return;
    setLanguages(code === source ? otherThan(code, target) : source, code);
  }
}

export function swapLanguages(detected?: string | null): void {
  const from = state.source === 'auto' ? (detected ?? null) : state.source;
  if (!from || from === state.target) return;
  setLanguages(state.target, from);
}

/* ------------------------------------------------------------------ settings */

export function updateSettings(patch: Partial<Settings>): void {
  const settings = { ...state.settings, ...patch };
  setState({ settings });
  persist('settings', settings);
}

/** Sets (or with null clears) the speech dialect used for a language, e.g. ('ar', 'ar-EG'). */
export function setDialect(code: string, locale: string | null): void {
  const dialects = { ...state.settings.dialects };
  if (locale) dialects[code] = locale;
  else delete dialects[code];
  updateSettings({ dialects });
}
