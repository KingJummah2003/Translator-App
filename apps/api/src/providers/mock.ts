import type { TranslationProvider } from './types';

/** Local development and tests: no network, deterministic output. */
export const mockProvider: TranslationProvider = {
  name: 'mock',
  maxBatchChars: 5000,
  maxBatchSegments: 128,
  async translate(texts, source, target) {
    return {
      translations: texts.map((t) => `[${target}] ${t}`),
      detectedSource: source === 'auto' ? 'en' : null,
    };
  },
  async ocr() {
    return { text: 'Sample text from image', detectedSource: 'en' };
  },
};
