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

interface NativeModule {
  isTranslationAvailable(): boolean;
  isTextRecognitionAvailable(): boolean;
  /** Script names Vision/ML Kit can read on this device, e.g. ['latin', 'arabic']. */
  supportedRecognitionLanguages(): string[];
  translate(text: string, source: string, target: string): Promise<string>;
  downloadModel(language: string, wifiOnly: boolean): Promise<void>;
  deleteModel(language: string): Promise<void>;
  getDownloadedModels(): Promise<string[]>;
  identifyLanguage(text: string): Promise<string>;
  recognizeText(uri: string, languages: string[]): Promise<RecognizedText>;
  addListener(event: 'onDownloadProgress', listener: (e: { language: string; progress: number }) => void): EventSubscription;
}

const native = requireOptionalNativeModule<NativeModule>('TranslatorNative');

export const translationAvailable = native?.isTranslationAvailable() ?? false;
export const textRecognitionAvailable = native?.isTextRecognitionAvailable() ?? false;

function required(): NativeModule {
  if (!native) throw new Error('On-device translation is not available in this build');
  return native;
}

export const TranslatorNative = {
  translate: (text: string, source: string, target: string) => required().translate(text, source, target),
  downloadModel: (language: string, wifiOnly: boolean) => required().downloadModel(language, wifiOnly),
  deleteModel: (language: string) => required().deleteModel(language),
  getDownloadedModels: async () => (native && translationAvailable ? native.getDownloadedModels() : []),
  /** BCP-47 code, or 'und' when unsure. */
  identifyLanguage: async (text: string) => (native && translationAvailable ? native.identifyLanguage(text) : 'und'),
  recognizeText: (uri: string, languages: string[]) => required().recognizeText(uri, languages),
  supportedRecognitionLanguages: () => native?.supportedRecognitionLanguages() ?? [],
  onDownloadProgress(listener: (e: { language: string; progress: number }) => void) {
    return native?.addListener('onDownloadProgress', listener) ?? { remove() {} };
  },
};
