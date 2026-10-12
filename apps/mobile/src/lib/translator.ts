import {
  COSTS,
  getLanguage,
  offlineQualityTier,
  translateProtected,
  type Entitlements,
  type OcrResponse,
  type OfflineQuality,
  type TranslateResponse,
} from '@translator/shared';
import { NetworkStateType, getNetworkStateAsync } from 'expo-network';
import { TranslatorNative, nativeErrorCode, translationAvailable, type NativeErrorCode } from 'translator-native';
import { apiJson, ApiError } from './api';
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
  /** What was translated (trimmed), and the languages asked for ('auto' stays 'auto'). */
  input: string;
  source: string;
  target: string;
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
  // Nothing to translate: translateText hands the text back without a model or credits.
  if (source === target) return { kind: 'offline' };
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

/* ------------------------------------------------------------------ quality */

export type { OfflineQuality };

/**
 * How well the on-device model translates this language, from a human review
 * (packages/shared/src/quality.ts). English is the pivot every score is measured from.
 */
export function offlineQuality(code: string): OfflineQuality {
  return code === PIVOT ? 'good' : offlineQualityTier(code);
}

const QUALITY_RANK: Record<OfflineQuality, number> = { basic: 0, fair: 1, good: 2 };

/** The weaker side of a pair decides; 'auto' and English do not count. */
export function offlinePairQuality(source: string, target: string): OfflineQuality {
  return [source, target]
    .filter((c) => c !== 'auto' && c !== PIVOT)
    .map(offlineQuality)
    .reduce<OfflineQuality>((worst, q) => (QUALITY_RANK[q] < QUALITY_RANK[worst] ? q : worst), 'good');
}

/* ------------------------------------------------------------------ engine errors */

/**
 * Stable codes for on-device failures, so the UI can show a localized message (errorMessage
 * in errors.ts) instead of native English text: the native module's codes plus
 * DETECT_FAILED (the language could not be recognised).
 */
export type EngineErrorCode = NativeErrorCode | 'DETECT_FAILED';

const KNOWN_CODES: readonly EngineErrorCode[] = [
  'ON_DEVICE_UNAVAILABLE',
  'UNSUPPORTED_LANGUAGE',
  'MODEL_MISSING',
  'TRANSLATE_FAILED',
  'DOWNLOAD_FAILED',
  'DELETE_FAILED',
  'LIST_FAILED',
  'BAD_IMAGE',
  'OCR_FAILED',
  'OCR_UNAVAILABLE',
  'BAD_PDF',
  'LOCKED_PDF',
  'NO_CONTEXT',
  'DETECT_FAILED',
];

// Messages read "CODE" or "CODE:language", e.g. "MODEL_MISSING:ar". Older iOS builds only
// had the code in the message, wrapped as "Call to function ... → Caused by: MODEL_MISSING:ar".
const CODE_IN_MESSAGE = new RegExp(`\\b(${KNOWN_CODES.join('|')})(?::([a-z]{2,3}(?:-[A-Za-z0-9]+)?))?`);

/**
 * An on-device failure. Like a native rejection, the message is "CODE" or "CODE:language",
 * which errors.ts reads; it is never shown as is.
 */
export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    readonly language: string | null = null,
    message?: string,
  ) {
    super(message ?? (language ? `${code}:${language}` : code));
    this.name = 'EngineError';
  }
}

export class ModelMissingError extends EngineError {
  constructor(readonly missing: string[]) {
    super('MODEL_MISSING', missing[0] ?? null, `Missing language models: ${missing.join(', ')}`);
    this.name = 'ModelMissingError';
  }
}

/** The stable code (and language, if any) of an on-device failure; null for other errors. */
export function engineErrorInfo(e: unknown): { code: EngineErrorCode; language: string | null } | null {
  if (e instanceof EngineError) return { code: e.code, language: e.language };
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const match = CODE_IN_MESSAGE.exec(message);
  const code = nativeErrorCode(e) ?? (match?.[1] as EngineErrorCode | undefined);
  if (!code) return null;
  return { code, language: match?.[1] === code ? (match[2] ?? null) : null };
}

/** Wraps any on-device failure in an EngineError; `fallback` is the code when it has none. */
export function toEngineError(e: unknown, fallback: EngineErrorCode, language: string | null = null): EngineError {
  if (e instanceof EngineError) return e;
  const info = engineErrorInfo(e);
  const code = info?.code ?? fallback;
  const lang = info?.language ?? language;
  if (code === 'MODEL_MISSING') return new ModelMissingError(lang ? [lang] : []);
  return new EngineError(code, lang);
}

/* ------------------------------------------------------------------ translation */

/** Normalises ML Kit language-ID output to our codes. */
function fromLanguageId(code: string): string | null {
  if (!code || code === 'und') return null;
  const base = code.replace(/-Latn$/, '');
  const mapped = base === 'iw' ? 'he' : base === 'fil' ? 'tl' : base === 'nb' ? 'no' : base;
  return getLanguage(mapped) ? mapped : null;
}

/** On-device language identification. Never rejects: null when unsure or unavailable. */
export async function detectLanguage(text: string): Promise<string | null> {
  if (!translationAvailable || text.trim().length < 2) return null;
  try {
    return fromLanguageId(await TranslatorNative.identifyLanguage(text));
  } catch {
    return null;
  }
}

/**
 * Translates on the device or in the cloud. With `record` (the default) the result is saved
 * to history; live typing passes `record: false` and calls recordHistory once the user is
 * done with the phrase, so history does not fill up with every half-typed version.
 */
export async function translateText(
  text: string,
  source: string,
  target: string,
  opts: { engine: Engine; record?: boolean },
): Promise<TranslationResult> {
  const input = text.trim();
  const asked = { input, source, target };
  // Nothing to translate: no model, no credits and no history entry.
  if (!input || source === target) {
    return { ...asked, text: input, engine: opts.engine, detectedSource: null, charged: 0 };
  }

  let result: TranslationResult;
  if (opts.engine === 'offline') {
    const detected = source === 'auto' ? await detectLanguage(input) : null;
    const from = source === 'auto' ? detected : source;
    if (!from) throw new EngineError('DETECT_FAILED');
    if (from === target) return { ...asked, text: input, engine: 'offline', detectedSource: detected, charged: 0 };
    const missing = requiredModels(from, target).filter((c) => !getState().downloadedModels.includes(c));
    if (missing.length) throw new ModelMissingError(missing);
    result = { ...asked, text: await translateOffline(input, from, target), engine: 'offline', detectedSource: detected, charged: 0 };
  } else {
    const res = await apiJson<TranslateResponse>('/v1/translate', { method: 'POST', json: { text: input, source, target } });
    updateBalance(res.balance);
    result = { ...asked, text: res.translation, engine: 'cloud', detectedSource: res.detectedSource, charged: res.charged };
  }

  if (opts.record !== false) void recordHistory(result, { revise: false });
  return result;
}

/**
 * Saves a finished translation to history, if the user keeps history. Safe to call more
 * than once for the same result (on pause, blur, copy, share or listen): a repeat is
 * ignored, and with `revise` (the default) a longer version of the phrase just saved
 * replaces that entry instead of adding another. Never rejects.
 */
export function recordHistory(result: TranslationResult, opts: { revise?: boolean } = {}): Promise<void> {
  const source = result.detectedSource ?? result.source;
  if (!getState().settings.saveHistory || !result.input || !result.text || source === result.target) {
    return Promise.resolve();
  }
  return addHistory(
    { source, target: result.target, input: result.input, output: result.text, engine: result.engine },
    { revise: opts.revise ?? true },
  ).catch(() => {});
}

/**
 * On-device translation with emails, web addresses and phone numbers shielded from the
 * model (which otherwise mangles them). Throws EngineError (ModelMissingError for a missing model).
 */
export async function translateOffline(text: string, from: string, to: string): Promise<string> {
  if (from === to || !text.trim()) return text;
  if (from === 'auto') throw new EngineError('DETECT_FAILED');
  if (!translationAvailable) throw new EngineError('ON_DEVICE_UNAVAILABLE');
  try {
    return await translateProtected(text, (t) => TranslatorNative.translate(t, from, to));
  } catch (e) {
    const err = toEngineError(e, 'TRANSLATE_FAILED');
    // A model was removed behind our back (system storage cleanup): re-plan the route.
    if (err instanceof ModelMissingError) void refreshDownloadedModels();
    throw err;
  }
}

/**
 * Translates a document's segments on the device, one at a time, reporting progress from
 * 0 to 1 after each. Aborting rejects with an AbortError between segments.
 */
export async function translateSegmentsOffline(
  segments: readonly string[],
  from: string,
  to: string,
  opts: { onProgress?: (progress: number) => void; signal?: AbortSignal } = {},
): Promise<string[]> {
  const out: string[] = [];
  for (const segment of segments) {
    if (opts.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    out.push(await translateOffline(segment, from, to));
    opts.onProgress?.(out.length / segments.length);
  }
  return out;
}

export function cloudCost(text: string): number {
  return COSTS.translateText(text.trim().length);
}

/* ------------------------------------------------------------------ cloud OCR */

export async function cloudOcr(imageBase64: string, target: string): Promise<OcrResponse> {
  const res = await apiJson<OcrResponse>('/v1/ocr', { method: 'POST', json: { image: imageBase64, target } });
  updateBalance(res.balance);
  return res;
}

/* ------------------------------------------------------------------ language models */

let refreshRun = 0;

/** Re-reads which models are on the phone. Never rejects; keeps the last list on failure. */
export async function refreshDownloadedModels(): Promise<void> {
  if (!translationAvailable) return;
  const run = ++refreshRun;
  try {
    const models = await TranslatorNative.getDownloadedModels();
    // An older, slower call must not overwrite a newer answer.
    if (run === refreshRun) setState({ downloadedModels: models });
  } catch {
    // Keep the last known list.
  }
}

const inflight = new Map<string, Promise<void>>();
let progressSubscribed = false;

function watchDownloadProgress(): void {
  if (progressSubscribed) return;
  progressSubscribed = true;
  TranslatorNative.onDownloadProgress(({ language, progress }) =>
    setState((s) => (language in s.downloading ? { downloading: { ...s.downloading, [language]: progress } } : {})),
  );
}

/** With no network at all ML Kit would wait silently, leaving the progress at 0. */
async function hasNoNetwork(): Promise<boolean> {
  try {
    return (await getNetworkStateAsync()).type === NetworkStateType.NONE;
  } catch {
    return false; // Unknown: let ML Kit try.
  }
}

/**
 * True while downloads wait for Wi-Fi: "Download on Wi-Fi only" is on and the phone is on
 * mobile data, so ML Kit holds them until Wi-Fi is back. Show t('waitingForWifi') instead of
 * a progress bar stuck at 0. Pass useNetworkState().type.
 */
export function downloadsWaitingForWifi(networkType: NetworkStateType | undefined): boolean {
  const s = getState();
  return (
    s.settings.wifiOnlyDownloads &&
    networkType === NetworkStateType.CELLULAR &&
    Object.values(s.downloading).some((progress) => progress < 1)
  );
}

function downloadOne(language: string, wifiOnly: boolean): Promise<void> {
  const running = inflight.get(language);
  if (running) return running;
  const job = (async () => {
    setState((s) => ({ downloading: { ...s.downloading, [language]: 0 } }));
    try {
      await TranslatorNative.downloadModel(language, wifiOnly);
    } catch (e) {
      throw toEngineError(e, 'DOWNLOAD_FAILED', language);
    } finally {
      // Refresh first, so the language never shows as "not downloaded" in between.
      await refreshDownloadedModels();
      inflight.delete(language);
      setState((s) => {
        const downloading = { ...s.downloading };
        delete downloading[language];
        return { downloading };
      });
    }
  })();
  inflight.set(language, job);
  return job;
}

/**
 * Downloads the models for these languages (plus the English pivot). Languages already
 * downloading are joined, not started twice, and one failure does not stop the others.
 * Rejects with the first EngineError once every download has settled. On mobile data with
 * Wi-Fi-only downloads it waits for Wi-Fi (see downloadsWaitingForWifi).
 */
export async function downloadModels(languages: string[]): Promise<void> {
  if (!translationAvailable) throw new EngineError('ON_DEVICE_UNAVAILABLE');
  const wifiOnly = getState().settings.wifiOnlyDownloads;
  const have = new Set(getState().downloadedModels);
  const todo = [...new Set([...languages, PIVOT])].filter((c) => offlineCapable(c) && !have.has(c));
  if (!todo.length) return;
  // errors.ts reads DOWNLOAD_FAILED as "check your connection".
  if (await hasNoNetwork()) throw new EngineError('DOWNLOAD_FAILED', todo.find((c) => c !== PIVOT) ?? null);
  watchDownloadProgress();
  const results = await Promise.allSettled(todo.map((c) => downloadOne(c, wifiOnly)));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
}

export async function deleteModel(language: string): Promise<void> {
  if (language === PIVOT || !translationAvailable) return;
  try {
    await TranslatorNative.deleteModel(language);
  } catch (e) {
    throw toEngineError(e, 'DELETE_FAILED', language);
  } finally {
    await refreshDownloadedModels();
  }
}

/* ------------------------------------------------------------------ entitlements */

/** Never rejects: on failure the cached entitlements stay (cleared only on a 401). */
let lastEntitlementsFetch = 0;

/**
 * Re-reads the balance unless it was fetched within `maxAgeMs`. Credits can change outside
 * the app (a purchase on another device, a support grant, the weekly VIP reset), so screens
 * that show the balance call this when they come into view and when the app returns.
 */
export function refreshEntitlementsIfStale(maxAgeMs = 15_000): void {
  if (Date.now() - lastEntitlementsFetch < maxAgeMs) return;
  void refreshEntitlements();
}

export async function refreshEntitlements(): Promise<Entitlements | null> {
  lastEntitlementsFetch = Date.now();
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

/* ------------------------------------------------------------------ care warning */

export type CareTopic = 'emergency' | 'allergy' | 'dosage' | 'medical' | 'legal';

/** Most urgent first; careTopics() returns topics in this order. */
const CARE_PRIORITY: readonly CareTopic[] = ['emergency', 'allergy', 'dosage', 'medical', 'legal'];

/**
 * Words that mark text where a wrong on-device translation could hurt someone (the quality
 * review found medical wording often takes the wrong sense). English and Arabic in depth
 * (MSA plus common dialect words), and the usual French, Spanish and German forms. Terms
 * are folded like the input (case, accents, Arabic letter variants), so write them
 * naturally. "word*" matches words starting with it, "*part*" words containing it (German
 * compounds), several words match as a phrase. Words that are everyday words in another of
 * these languages are left out on purpose: "pain" (French bread), "gift" (German poison),
 * "visa" (the card), "Gericht" (a dish), "avocat" (avocado), "deportes" (sports).
 */
const CARE_TERMS: Record<CareTopic, readonly string[]> = {
  emergency: [
    // en
    'emergency', 'emergencies', 'ambulanc*', 'paramedic*', 'police', 'policeman', 'policewoman',
    'firefighter*', 'fire brigade', 'fire department', 'on fire', 'unconscious', 'not breathing',
    "can't breathe", 'cant breathe', 'cannot breathe', 'stopped breathing', 'difficulty breathing',
    'shortness of breath', 'short of breath', 'choking', 'overdos*', 'poison*', 'suicid*', 'kill myself',
    'heart attack', 'cardiac arrest', 'stroke', 'seizure*', 'convuls*', 'bleeding', 'drowning', 'drowned',
    'fainted', 'collapsed', 'accident', 'accidents', 'injured', 'injury', 'injuries', 'mayday',
    'intensive care', 'cpr',
    // fr
    'urgence*', 'secours', 'pompiers', 'gendarmerie', 'samu', 'inconscient*', 'evanoui*', 'ne respire plus',
    'ne respire pas', 'crise cardiaque', 'infarctus', 'avc', 'blessure*', 'blesse', 'blessee', 'blesses',
    'noyade', 'surdose',
    // es
    'emergencia*', 'urgencia*', 'policia', 'bomberos', 'socorro', 'inconsciente', 'desmay*', 'no respira',
    'no puede respirar', 'infarto', 'ictus', 'sobredosis', 'envenen*', 'herido', 'herida', 'heridos',
    'accidente', 'accidentes', 'ahogad*', 'asfixi*',
    // de
    'notfall*', 'notruf*', 'notaufnahme', 'notarzt', 'krankenwagen', 'rettungswagen', 'rettungsdienst',
    'polizei', 'feuerwehr', 'bewusstlos', 'ohnmacht*', 'atmet nicht', 'keine luft', 'herzinfarkt',
    'schlaganfall', 'überdosis', 'vergift*', 'verletzt', 'verletzung*', 'unfall*', 'ertrunken', 'erstick*',
    'selbstmord*', 'suizid*',
    // ar
    'طوارئ', 'إسعاف*', 'النجدة', 'نجدة', 'شرطة', 'بوليس', 'حريق', 'حادث', 'حوادث', 'اختناق', 'إغماء',
    'مغمى عليه', 'لا يتنفس', 'ما يتنفس', 'انتحار', 'نوبة قلبية', 'أزمة قلبية', 'جلطة', 'سكتة', 'تسمم', 'نزيف',
    'ينزف', 'غرق', 'جرعة زائدة',
  ],
  allergy: [
    // en, fr, de share the stem; es drops an l
    '*allerg*', 'alerg*', 'anaphyla*', 'anafila*', 'epipen*', 'epinephrine', 'gluten*', 'lactose', 'lactosa',
    'laktose*', 'celiac*', 'coeliac*', 'cœliaque', 'celíaco', 'zöliakie', 'peanut*', 'tree nut', 'tree nuts',
    'shellfish', 'intoleran*', 'cacahuète*', 'cacahuete*', 'arachide*', 'erdnuss*',
    // ar
    'حساسي*', 'تحسس*', 'فول سوداني', 'مكسرات', 'غلوتين', 'جلوتين', 'غلوتن', 'لاكتوز', 'سيلياك', 'قشريات',
  ],
  dosage: [
    // en
    'dose', 'doses', 'dosage*', 'dosing', 'milligram*', 'microgram*', 'mg', 'mcg', 'tablet', 'tablets', 'pill',
    'pills', 'capsule', 'capsules', 'injection', 'injections', 'syringe*', 'twice a day', 'twice daily',
    'once a day', 'once daily', 'times a day', 'times daily', 'times per day', 'before meals', 'after meals',
    'with meals', 'on an empty stomach',
    // fr, es, de
    'posologie', 'posología', 'comprim*', 'gélule*', 'fois par jour', 'à jeun', 'dosis', 'pastilla*',
    'cápsula*', 'jarabe', 'inyección*', 'miligramo*', 'veces al día', 'veces por día', 'vez al día',
    'en ayunas', 'dosierung*', 'tablette*', 'spritze', 'mal täglich', 'mal am tag',
    // ar
    'جرعة', 'جرعات', 'جرعت*', 'ملغ', 'ملغم', 'ملجم', 'مجم', 'مليغرام', 'ملليغرام', 'ميليغرام', 'مليجرام',
    'ملليجرام', 'حبوب', 'أقراص', 'قرص', 'كبسولة', 'كبسولات', 'حقنة', 'حقن', 'على معدة فارغة',
  ],
  medical: [
    // en
    'doctor', 'doctors', 'physician*', 'hospital', 'hospitals', 'hospitalized', 'hospitalised', 'clinic',
    'clinics', 'nurse', 'nurses', 'pharmac*', 'prescri*', 'medic*', 'symptom*', 'diagnos*', 'surgery',
    'surgeon*', 'surgical', 'fever', 'feverish', 'diabet*', 'insulin*', 'asthma*', 'inhaler*', 'blood',
    'bleed', 'bleeds', 'pregnan*', 'vaccin*', 'antibiot*', 'infect*', 'side effect', 'side effects',
    'blood pressure', 'nause*', 'vomi*', 'dizz*', 'vertig*', 'rash', 'cancer*', 'epilep*', 'chemo*', 'dialys*',
    'heart condition', 'chest pain', 'in pain', 'severe pain', 'painful', 'painkiller*', 'pain killer',
    'pain killers', 'it hurts', 'headache*', 'migrain*', 'fracture*', 'broken bone', 'wound', 'wounds', 'sick',
    'illness*', 'disease*', 'malad*', 'virus', 'covid*', 'wheelchair', 'icu',
    // fr
    'médecin*', 'docteur', 'hôpital', 'hôpitaux', 'clinique', 'infirmi*', 'ordonnance', 'douleur*', 'fièvre',
    'enceinte', 'saign*', 'diabète', 'asthme', "j'ai mal", 'mal de tête', 'mal au ventre', 'effet secondaire',
    'effets secondaires', 'tension artérielle',
    // es
    'doctora', 'hospitalizado', 'hospitalizada', 'clínica', 'farmacia*', 'enferm*', 'receta médica', 'dolor',
    'dolores', 'me duele', 'fiebre', 'embarazada', 'embarazo', 'sangre', 'sangrado', 'sangrando', 'vacuna*',
    'síntoma*', 'asma', 'presión arterial', 'efecto secundario', 'efectos secundarios', 'cirug*', 'ciruj*',
    'fractura*', 'mareo*', 'infecc*',
    // de
    'arzt', '*arzt*', 'krank*', 'apotheke*', 'klinik*', 'medikament*', 'medizin*', '*schmerz*', 'fieber',
    'schwanger*', 'blut', 'bluten', 'blutet', 'blutung*', 'blutdruck', 'blutzucker', 'impf*', 'infekt*',
    'nebenwirkung*', 'übelkeit', 'erbrechen', 'schwindelig', 'durchfall', 'tut weh', 'rezeptpflichtig',
    'verschreib*', 'chirurg*',
    // ar
    'طبيب*', 'أطباء', 'دكتور*', 'مستشف*', 'عيادة', 'عيادات', 'عيادت*', 'صيدل*', 'دواء', 'دوائي', 'دوا',
    'أدوية', 'علاج', 'وصفة طبية', 'روشتة', 'ممرض*', 'مريض*', 'مرضى', 'مرض', 'أمراض', 'ألم', 'ألمي', 'بألم',
    'آلام', 'وجع', 'أوجاع', 'يؤلمني', 'تؤلمني', 'يوجعني', 'توجعني', 'صداع', 'حمى', 'سخونة', 'سكري', 'أنسولين',
    'انسولين', 'ربو', 'بخاخ', 'ضغط الدم', 'دم', 'حامل', 'لقاح*', 'تطعيم*', 'مضاد حيوي', 'مضادات حيوية',
    'التهاب', 'عدوى', 'أعراض', 'تشخيص', 'جراحة', 'جراحية', 'سرطان', 'صرع', 'غثيان', 'دوخة', 'إسهال', 'استفراغ',
    'تقيؤ', 'طفح جلدي', 'جرح', 'جروح', 'إصابة', 'مسكنات', 'طبي', 'طبية', 'غسيل كلوي', 'فيروس',
  ],
  legal: [
    // en
    'lawyer*', 'attorney*', 'solicitor*', 'barrister*', 'courtroom', 'in court', 'court order', 'court date',
    'court case', 'court hearing', 'tribunal*', 'judge', 'contract*', 'legal*', 'illegal*', 'the law',
    'by law', 'against the law', 'law firm', 'law enforcement', 'lawsuit*', 'sued', 'suing', 'arrest*',
    'custody', 'warrant', 'liabil*', 'liable', 'testimony', 'witness', 'witnesses', 'affidavit*', 'notary',
    'notarized', 'notarised', 'embassy', 'embassies', 'consulate*', 'asyl*', 'deportation', 'deported',
    'deport', 'immigration', 'divorce*', 'inheritance', 'lease', 'tenancy', 'evict*', 'terms and conditions',
    'plaintiff*', 'defendant*', 'verdict*', 'consent',
    // fr
    'juridique*', 'contrat*', 'loi', 'lois', 'juge', 'ambassade*', 'consulat*', 'notaire*', 'garde à vue',
    'plainte', 'procès', 'témoin*', 'expulsion', 'asile',
    // es
    'abogad*', 'juzgado', 'juez', 'ley', 'leyes', 'jurídic*', 'detenido', 'detenida', 'embajada*',
    'consulado*', 'notario*', 'divorcio', 'herencia', 'testigo*', 'visado', 'deportación', 'deportado',
    'inmigración', 'denuncia*', 'asilo',
    // de
    '*anwalt*', 'gerichts*', 'gerichtlich*', '*vertrag*', '*gesetz*', 'rechtlich*', 'verhaftet',
    'festgenommen', 'konsulat*', 'notariell*', 'scheidung*', 'erbschaft*', 'visum', 'abschiebung*',
    'kündigung*',
    // ar
    'محامي', 'محام', 'محامية', 'محامون', 'محامين', 'محاماة', 'محكمة', 'محاكم', 'قاضي', 'قاض', 'قانون*',
    'قوانين', 'عقد', 'عقود', 'اتفاقية', 'دعوى', 'اعتقال', 'القبض على', 'تأشيرة', 'تأشيرات', 'جواز سفر',
    'جواز السفر', 'سفارة', 'قنصلية', 'لجوء', 'ترحيل', 'غرامة', 'مخالفة', 'طلاق', 'ميراث', 'إرث', 'توكيل',
    'كاتب عدل', 'كاتب العدل', 'كاتب بالعدل', 'توقيع', 'حقوقي', 'شكوى', 'بلاغ',
  ],
};

/** Amounts and schedules that only make sense for medicine ("500mg", "every 8 hours"). */
const CARE_PATTERNS: readonly (readonly [RegExp, CareTopic])[] = [
  [/ \d+ ?(?:mg|mcg|ug|iu) /, 'dosage'],
  [/ (?:every|toutes les|cada|alle) \d+ (?:hours?|heures?|horas?|stunden?) /, 'dosage'],
  [/ كل \d+ ساع/, 'dosage'],
  [/ (?:مره|مرتين|مرات)(?: [^ ]+)? (?:يوميا|في اليوم|باليوم) /, 'dosage'],
];

const LATIN_FOLD: Record<string, string> = {
  à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a', æ: 'ae', ç: 'c', è: 'e', é: 'e', ê: 'e', ë: 'e', ì: 'i',
  í: 'i', î: 'i', ï: 'i', ñ: 'n', ò: 'o', ó: 'o', ô: 'o', õ: 'o', ö: 'o', ø: 'o', œ: 'oe', ù: 'u', ú: 'u',
  û: 'u', ü: 'u', ý: 'y', ÿ: 'y', ß: 'ss', µ: 'u', μ: 'u',
};

/**
 * Lower case without what varies in how people type the same word: Latin accents, Arabic
 * vowel marks and tatweel, alef/yeh/teh-marbuta variants, Persian letters, Eastern digits.
 * Done by hand rather than with normalize('NFD') so it does not depend on Hermes' Intl.
 */
function foldForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/[̀-ͯ]/g, '')
    .replace(/[àáâãäåæçèéêëìíîïñòóôõöøœùúûüýÿßµμ]/g, (ch) => LATIN_FOLD[ch] ?? ch)
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** A word: Latin letters and digits, or Arabic-script letters. Apostrophes split (l'hôpital). */
const WORD = /[a-z0-9]+|[ء-غف-يٮ-ۓۺ-ۿ]+/g;
const ARABIC_WORD = /^[ء-ۿ]/;
const AR_CONJUNCTION = /^[وف]/;
const AR_ARTICLE = /^(?:بال|كال|فال|وال|لل|ال)/;
const AR_PREPOSITION = /^[بلك]/;
const AR_SUFFIXES = ['هما', 'كما', 'هم', 'هن', 'كم', 'نا', 'ها', 'ي', 'ك', 'ه'];
/**
 * Prefix terms are at least this long and are looked up by their first letters. Forms found
 * by peeling off a bare one-letter prefix or a suffix also only match terms this long.
 */
const MIN_STEM = 4;

interface CareIndex {
  exact: Map<string, CareTopic>;
  /** Prefix terms keyed by their first MIN_STEM letters. */
  prefix: Map<string, (readonly [string, CareTopic])[]>;
  contains: (readonly [string, CareTopic])[];
  phrases: (readonly [string, CareTopic])[];
}

let careIndex: CareIndex | null = null;

function getCareIndex(): CareIndex {
  if (careIndex) return careIndex;
  const index: CareIndex = { exact: new Map(), prefix: new Map(), contains: [], phrases: [] };
  for (const topic of CARE_PRIORITY) {
    for (const term of CARE_TERMS[topic]) {
      const words = foldForMatching(term.replace(/\*/g, ' ')).match(WORD) ?? [];
      const word = words[0];
      if (!word) continue;
      if (words.length > 1) {
        index.phrases.push([` ${words.join(' ')} `, topic]);
      } else if (term.startsWith('*') && term.endsWith('*')) {
        index.contains.push([word, topic]);
      } else if (term.endsWith('*') && word.length >= MIN_STEM) {
        const head = word.slice(0, MIN_STEM);
        index.prefix.set(head, [...(index.prefix.get(head) ?? []), [word, topic]]);
      } else if (!index.exact.has(word)) {
        index.exact.set(word, topic);
      }
    }
  }
  careIndex = index;
  return index;
}

/**
 * The forms of a word worth looking up. Arabic attaches "and", "the", prepositions and
 * pronouns to the word (والمستشفى, بالدواء, دوائي), so those are peeled off. A form is
 * "loose" when only a bare one-letter preposition or a suffix was removed: لحمي ("my meat")
 * must not become حمي ("fever").
 */
function wordForms(token: string): (readonly [string, boolean])[] {
  const forms: (readonly [string, boolean])[] = [[token, false]];
  if (!ARABIC_WORD.test(token)) return forms;
  let rest = token;
  let loose = false;
  if (AR_CONJUNCTION.test(rest) && rest.length > 3) {
    rest = rest.slice(1);
    loose = true;
  }
  const article = AR_ARTICLE.exec(rest)?.[0];
  if (article && rest.length - article.length >= 2) {
    forms.push([rest.slice(article.length), false]);
  } else {
    if (loose) forms.push([rest, true]);
    if (AR_PREPOSITION.test(rest) && rest.length > 3) forms.push([rest.slice(1), true]);
  }
  for (const [form] of [...forms]) {
    for (const suffix of AR_SUFFIXES) {
      if (form.endsWith(suffix) && form.length - suffix.length >= 3) forms.push([form.slice(0, -suffix.length), true]);
    }
  }
  return forms;
}

const CARE_SCAN_LIMIT = 10_000;

function scanCare(text: string, firstOnly: boolean): CareTopic[] {
  const tokens = foldForMatching(text.slice(0, CARE_SCAN_LIMIT)).match(WORD);
  if (!tokens) return [];
  const index = getCareIndex();
  const found = new Set<CareTopic>();
  const done = () => firstOnly && found.size > 0;

  for (const token of tokens) {
    for (const [form, loose] of wordForms(token)) {
      const exact = index.exact.get(form);
      if (exact && (!loose || form.length >= MIN_STEM)) found.add(exact);
      for (const [stem, topic] of index.prefix.get(form.slice(0, MIN_STEM)) ?? []) {
        if (form.startsWith(stem)) found.add(topic);
      }
    }
    for (const [part, topic] of index.contains) {
      if (token.includes(part)) found.add(topic);
    }
    if (done()) return [...found];
  }

  const joined = ` ${tokens.join(' ')} `;
  for (const [phrase, topic] of index.phrases) {
    if (joined.includes(phrase)) found.add(topic);
    if (done()) return [...found];
  }
  for (const [pattern, topic] of CARE_PATTERNS) {
    if (pattern.test(joined)) found.add(topic);
    if (done()) return [...found];
  }
  return CARE_PRIORITY.filter((topic) => found.has(topic));
}

/**
 * What makes this text risky to translate on the device, most urgent first: emergency,
 * allergy, dosage, medical or legal content. Empty when none. Pure and synchronous.
 */
export function careTopics(text: string): CareTopic[] {
  return scanCare(text, false);
}

// Screens ask during render, often several times for the same text.
let lastCareText = '';
let lastCareAnswer = false;

/**
 * True when the text looks medical, allergy, dosage, legal or emergency related (English,
 * Arabic, and common French, Spanish and German words), so the UI can recommend cloud
 * translation over the on-device one.
 */
export function needsCareWarning(text: string): boolean {
  if (text !== lastCareText) {
    lastCareAnswer = scanCare(text, true).length > 0;
    lastCareText = text;
  }
  return lastCareAnswer;
}
