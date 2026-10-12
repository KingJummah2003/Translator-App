import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

/**
 * On-device translation (Google ML Kit), language identification and text recognition
 * (ML Kit on Android, Apple Vision on iOS). Everything here runs without a network
 * connection once a language model is downloaded, and nothing leaves the phone.
 *
 * The native module is missing in Expo Go, on the web and in the iOS Simulator (ML Kit
 * ships no Apple-silicon simulator build); `available` is false there and the app falls
 * back to cloud translation.
 */

export interface RecognizedBlock {
  text: string;
  /** Normalised 0..1 box, origin top-left. */
  frame: { x: number; y: number; width: number; height: number };
}

export interface RecognizedText {
  text: string;
  blocks: RecognizedBlock[];
}

export interface PdfText {
  /** Text of each page, in order. */
  pages: string[];
  pageCount: number;
  /** Pages read with OCR because they had no text layer (all pages on Android). */
  scannedPages: number;
}

/**
 * `code` of a rejected native call, the same on iOS and Android. The message has the form
 * "CODE" or "CODE:detail", e.g. "MODEL_MISSING:ar".
 */
export type NativeErrorCode =
  | 'ON_DEVICE_UNAVAILABLE' // iOS Simulator, Expo Go
  | 'UNSUPPORTED_LANGUAGE' // detail: the language code
  | 'MODEL_MISSING' // detail: the language whose model is not downloaded
  | 'TRANSLATE_FAILED'
  | 'DOWNLOAD_FAILED' // detail: the language code
  | 'DELETE_FAILED'
  | 'LIST_FAILED'
  | 'BAD_IMAGE'
  | 'OCR_FAILED'
  | 'OCR_UNAVAILABLE' // Android: Google Play services is still installing the text recognition model
  | 'BAD_PDF'
  | 'LOCKED_PDF'
  | 'NO_CONTEXT';

interface NativeModule {
  isTranslationAvailable(): boolean;
  isTextRecognitionAvailable(): boolean;
  /** Script names Vision/ML Kit can read on this device, e.g. ['latin', 'arabic']. */
  supportedRecognitionLanguages(): string[];
  /** Missing from builds made before it was added. */
  urlSchemes?(): string[];
  translate(text: string, source: string, target: string): Promise<string>;
  downloadModel(language: string, wifiOnly: boolean): Promise<void>;
  deleteModel(language: string): Promise<void>;
  getDownloadedModels(): Promise<string[]>;
  identifyLanguage(text: string): Promise<string>;
  recognizeText(uri: string, languages: string[]): Promise<RecognizedText>;
  extractPdfText(uri: string, languages: string[], maxPages: number): Promise<PdfText>;
  addListener(event: 'onDownloadProgress', listener: (e: { language: string; progress: number }) => void): EventSubscription;
}

const native = requireOptionalNativeModule<NativeModule>('TranslatorNative');

export const translationAvailable = native?.isTranslationAvailable() ?? false;
export const textRecognitionAvailable = native?.isTextRecognitionAvailable() ?? false;

function required(): NativeModule {
  if (!native) {
    // Same shape as a native rejection, so callers handle one kind of error.
    throw Object.assign(new Error('ON_DEVICE_UNAVAILABLE'), { code: 'ON_DEVICE_UNAVAILABLE' satisfies NativeErrorCode });
  }
  return native;
}

/** The native error code of a rejected call, or null for any other error. */
export function nativeErrorCode(e: unknown): NativeErrorCode | null {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z_]+$/.test(code) && !code.startsWith('ERR_') ? (code as NativeErrorCode) : null;
}

export const TranslatorNative = {
  translate: (text: string, source: string, target: string) => required().translate(text, source, target),
  downloadModel: (language: string, wifiOnly: boolean) => required().downloadModel(language, wifiOnly),
  deleteModel: (language: string) => required().deleteModel(language),
  getDownloadedModels: async () => (native && translationAvailable ? native.getDownloadedModels() : []),
  /** BCP-47 code, or 'und' when unsure. */
  identifyLanguage: async (text: string) => (native && translationAvailable ? native.identifyLanguage(text) : 'und'),
  recognizeText: (uri: string, languages: string[]) => required().recognizeText(uri, languages),
  /** Reads a PDF on the device (nothing is uploaded). Errors: BAD_PDF, LOCKED_PDF, OCR_UNAVAILABLE. */
  extractPdfText: (uri: string, languages: string[] = [], maxPages = 50) => required().extractPdfText(uri, languages, maxPages),
  supportedRecognitionLanguages: () => native?.supportedRecognitionLanguages() ?? [],
  /**
   * URL schemes registered in this build's Info.plist (iOS), or null when unknown (Android,
   * Expo Go, older builds). Google Sign-In aborts an iOS app whose reversed client ID is not
   * among them.
   */
  urlSchemes: (): string[] | null => (native?.urlSchemes ? native.urlSchemes() : null),
  onDownloadProgress(listener: (e: { language: string; progress: number }) => void) {
    return native?.addListener('onDownloadProgress', listener) ?? { remove() {} };
  },
};
