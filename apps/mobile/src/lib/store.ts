import { useSyncExternalStore } from 'react';
import type { Entitlements } from '@translator/shared';
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
}

const DEFAULT_SETTINGS: Settings = { saveHistory: true, autoSpeak: true, wifiOnlyDownloads: true, appLock: false };

let state: AppState = {
  ready: false,
  source: 'auto',
  target: uiLanguage === 'ar' ? 'en' : 'ar',
  recent: [],
  settings: DEFAULT_SETTINGS,
  downloadedModels: [],
  downloading: {},
  entitlements: null,
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

/* ------------------------------------------------------------------ persisted actions */

export async function loadPersisted(): Promise<void> {
  const [langs, recent, settings] = await Promise.all([
    kvGet<{ source: string; target: string } | null>('languages', null),
    kvGet<string[]>('recent', []),
    kvGet<Partial<Settings>>('settings', {}),
  ]);
  setState({
    ...(langs ?? {}),
    recent,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    ready: true,
  });
}

export function setLanguages(source: string, target: string): void {
  const recent = [target, source, ...state.recent].filter((c, i, all) => c !== 'auto' && all.indexOf(c) === i).slice(0, 8);
  setState({ source, target, recent });
  void kvSet('languages', { source, target });
  void kvSet('recent', recent);
}

export function swapLanguages(detected?: string | null): void {
  const from = state.source === 'auto' ? (detected ?? null) : state.source;
  if (!from) return;
  setLanguages(state.target, from);
}

export function updateSettings(patch: Partial<Settings>): void {
  const settings = { ...state.settings, ...patch };
  setState({ settings });
  void kvSet('settings', settings);
}
