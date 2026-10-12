import {
  COSTS,
  getLanguage,
  translateProtected,
  type Entitlements,
  type OcrResponse,
  type TranslateResponse,
} from '@translator/shared';
import { TranslatorNative, translationAvailable } from 'translator-native';
import { ApiError, apiJson } from './api';
import { addHistory } from './db';
import { getState, setState } from './store';

/**
 * The hybrid engine. Offline (on-device ML Kit) is always preferred: it is instant, free
 * and private. Cloud translation is used when a language has no offline model, when its
 * model is not downloaded yet, or when the user taps "Better quality".
 */

export type Engine = 'offline' | 'cloud';

export interface TranslationResult {
  text: string;
  engine: Engine;
  detectedSource: string | null;
  charged: number;
}

export type Route =
  | { kind: 'offline' }
  | { kind: 'cloud' }
  | { kind: 'download'; missing: string[]; cloudPossible: boolean }
  | { kind: 'sign-in' }
  | { kind: 'no-connection' };

/** The pivot language every ML Kit translation goes through. */
const PIVOT = 'en';

export function offlineCapable(code: string): boolean {
  return translationAvailable && getLanguage(code)?.offline === true;
}

/** Which models must be on the phone to translate this pair offline. */
export function requiredModels(source: string, target: string): string[] {
  return [...new Set([source, target, PIVOT])].filter((c) => c !== 'auto');
}

export function planRoute(
  source: string,
  target: string,
  ctx: { signedIn: boolean; online: boolean; preferCloud?: boolean },
): Route {
  const cloudPossible = ctx.signedIn && ctx.online;
  const offlinePair = offlineCapable(target) && (source === 'auto' || offlineCapable(source));
  if (ctx.preferCloud || !offlinePair) {
    if (cloudPossible) return { kind: 'cloud' };
    return ctx.online ? { kind: 'sign-in' } : { kind: 'no-connection' };
  }
  const downloaded = new Set(getState().downloadedModels);
  const missing = requiredModels(source, target).filter((c) => !downloaded.has(c));
  if (missing.length === 0) return { kind: 'offline' };
  return { kind: 'download', missing, cloudPossible };
}

/** Normalises ML Kit language-ID output to our codes. */
function fromLanguageId(code: string): string | null {
  if (!code || code === 'und') return null;
  const base = code.replace(/-Latn$/, '');
  const mapped = base === 'iw' ? 'he' : base === 'fil' ? 'tl' : base === 'nb' ? 'no' : base;
  return getLanguage(mapped) ? mapped : null;
}

export async function detectLanguage(text: string): Promise<string | null> {
  if (!translationAvailable || text.trim().length < 2) return null;
  return fromLanguageId(await TranslatorNative.identifyLanguage(text));
}

export async function translateText(
  text: string,
  source: string,
  target: string,
  opts: { engine: Engine; record?: boolean },
): Promise<TranslationResult> {
  const input = text.trim();
  let result: TranslationResult;

  if (opts.engine === 'offline') {
    const detected = source === 'auto' ? await detectLanguage(input) : null;
    const from = source === 'auto' ? detected : source;
    if (!from) throw new ApiError(400, 'bad_request', 'Could not detect the language. Choose it manually.');
    if (from === target) {
      result = { text: input, engine: 'offline', detectedSource: detected, charged: 0 };
    } else {
      const missing = requiredModels(from, target).filter((c) => !getState().downloadedModels.includes(c));
      if (missing.length) throw new ModelMissingError(missing);
      result = { text: await translateOffline(input, from, target), engine: 'offline', detectedSource: detected, charged: 0 };
    }
  } else {
    const res = await apiJson<TranslateResponse>('/v1/translate', { method: 'POST', json: { text: input, source, target } });
    updateBalance(res.balance);
    result = { text: res.translation, engine: 'cloud', detectedSource: res.detectedSource, charged: res.charged };
  }

  if (opts.record !== false && getState().settings.saveHistory && result.text) {
    void addHistory({
      source: result.detectedSource ?? source,
      target,
      input,
      output: result.text,
      engine: result.engine,
    }).catch(() => {});
  }
  return result;
}

/**
 * On-device translation with emails, web addresses and phone numbers shielded from the
 * model (which otherwise mangles them).
 */
export function translateOffline(text: string, from: string, to: string): Promise<string> {
  return translateProtected(text, (t) => TranslatorNative.translate(t, from, to));
}

export function cloudCost(text: string): number {
  return COSTS.translateText(text.trim().length);
}

export class ModelMissingError extends Error {
  constructor(readonly missing: string[]) {
    super(`Missing language models: ${missing.join(', ')}`);
  }
}

/* ------------------------------------------------------------------ cloud OCR */

export async function cloudOcr(imageBase64: string, target: string): Promise<OcrResponse> {
  const res = await apiJson<OcrResponse>('/v1/ocr', { method: 'POST', json: { image: imageBase64, target } });
  updateBalance(res.balance);
  return res;
}

/* ------------------------------------------------------------------ language models */

export async function refreshDownloadedModels(): Promise<void> {
  if (!translationAvailable) return;
  try {
    setState({ downloadedModels: await TranslatorNative.getDownloadedModels() });
  } catch {
    // Keep the last known list.
  }
}

export async function downloadModels(languages: string[]): Promise<void> {
  const wifiOnly = getState().settings.wifiOnlyDownloads;
  const todo = [...new Set([...languages, PIVOT])].filter((c) => !getState().downloadedModels.includes(c));
  setState((s) => ({ downloading: { ...s.downloading, ...Object.fromEntries(todo.map((c) => [c, 0])) } }));
  const sub = TranslatorNative.onDownloadProgress(({ language, progress }) =>
    setState((s) => (language in s.downloading ? { downloading: { ...s.downloading, [language]: progress } } : {})),
  );
  try {
    await Promise.all(todo.map((c) => TranslatorNative.downloadModel(c, wifiOnly)));
  } finally {
    sub.remove();
    setState((s) => {
      const downloading = { ...s.downloading };
      todo.forEach((c) => delete downloading[c]);
      return { downloading };
    });
    await refreshDownloadedModels();
  }
}

export async function deleteModel(language: string): Promise<void> {
  if (language === PIVOT) return;
  await TranslatorNative.deleteModel(language);
  await refreshDownloadedModels();
}

/* ------------------------------------------------------------------ entitlements */

export async function refreshEntitlements(): Promise<Entitlements | null> {
  try {
    const e = await apiJson<Entitlements>('/v1/me/entitlements');
    setState({ entitlements: e });
    return e;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) setState({ entitlements: null });
    return getState().entitlements;
  }
}

function updateBalance(balance: number) {
  setState((s) => (s.entitlements ? { entitlements: { ...s.entitlements, balance } } : {}));
}
