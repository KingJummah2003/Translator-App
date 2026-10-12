import { ApiError } from '../errors';
import type { TranslationProvider } from './types';

/**
 * DEVELOPMENT ONLY: MyMemory's free public API (no key, roughly 5,000 characters a day), so
 * the iOS Simulator, which cannot run on-device ML Kit, shows real translations. Text is sent
 * to a third party, so getProvider() refuses it outside development.
 */
const MAX_CHUNK = 450; // the API rejects queries over 500 bytes

const toMyMemory = (code: string) => (code === 'zh' ? 'zh-CN' : code === 'mni-Mtei' ? 'mni' : code);
const fromMyMemory = (code: string) => (code.startsWith('zh-') ? (code === 'zh-TW' ? 'zh-TW' : 'zh') : code.split('-')[0]!);

/** Splits at sentence ends (then spaces) so each request stays under the size limit. */
export function chunk(text: string, max = MAX_CHUNK): string[] {
  const out: string[] = [];
  let rest = text;
  while (new TextEncoder().encode(rest).length > max) {
    let cut = rest.slice(0, max);
    while (new TextEncoder().encode(cut).length > max) cut = cut.slice(0, -10);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '), cut.lastIndexOf('\n'));
    const at = end > max / 3 ? end + 1 : cut.lastIndexOf(' ') > max / 3 ? cut.lastIndexOf(' ') : cut.length;
    out.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest) out.push(rest);
  return out;
}

export const myMemoryProvider: TranslationProvider = {
  name: 'mymemory',
  maxBatchChars: 5000,
  maxBatchSegments: 32,
  async translate(texts, source, target) {
    let detectedSource: string | null = null;
    const translations: string[] = [];
    for (const text of texts) {
      if (!text.trim()) {
        translations.push(text);
        continue;
      }
      const parts: string[] = [];
      for (const piece of chunk(text)) {
        const from = source === 'auto' ? 'Autodetect' : toMyMemory(source);
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(piece)}&langpair=${encodeURIComponent(`${from}|${toMyMemory(target)}`)}`;
        const res = await fetch(url);
        const body = await res
          .json<{ responseStatus: number | string; responseData?: { translatedText?: string; detectedLanguage?: string }; quotaFinished?: boolean }>()
          .catch(() => null);
        if (!res.ok || !body || Number(body.responseStatus) !== 200 || body.quotaFinished) {
          throw new ApiError(502, 'upstream_error', 'The free test translator is unavailable (daily limit reached?).');
        }
        parts.push(body.responseData?.translatedText ?? '');
        if (!detectedSource && body.responseData?.detectedLanguage) detectedSource = fromMyMemory(body.responseData.detectedLanguage);
      }
      translations.push(parts.join(' ').replace(/\s+\n/g, '\n'));
    }
    return { translations, detectedSource: source === 'auto' ? (detectedSource ?? 'en') : null };
  },
  async ocr() {
    return { text: 'Sample text from image', detectedSource: 'en' };
  },
};
