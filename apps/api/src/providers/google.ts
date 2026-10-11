import { ApiError } from '../errors';
import type { TranslationProvider } from './types';

/**
 * Google Cloud Translation (v2 Basic) and Cloud Vision OCR with one API key.
 * The key travels in a header, never in the URL, so it can't leak into logs.
 * Restrict the key in Google Cloud to these two APIs only.
 */

// Our language codes that Google spells differently.
const TO_GOOGLE: Record<string, string> = { zh: 'zh-CN', he: 'iw' };
const FROM_GOOGLE: Record<string, string> = { 'zh-CN': 'zh', zh: 'zh', iw: 'he', fil: 'tl', nb: 'no' };

const toGoogle = (code: string) => TO_GOOGLE[code] ?? code;
const fromGoogle = (code: string | undefined) => (code ? (FROM_GOOGLE[code] ?? code) : null);

export function googleProvider(apiKey: string): TranslationProvider {
  async function call<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Log status only: the response can echo the request text.
      console.error(`google ${new URL(url).host} failed with ${res.status}`);
      throw new ApiError(502, 'upstream_error', 'The translation service is unavailable. You were not charged.');
    }
    return res.json<T>();
  }

  return {
    name: 'google',
    maxBatchChars: 5000,
    maxBatchSegments: 128,

    async translate(texts, source, target) {
      const data = await call<{
        data: { translations: { translatedText: string; detectedSourceLanguage?: string }[] };
      }>('https://translation.googleapis.com/language/translate/v2', {
        q: texts,
        target: toGoogle(target),
        ...(source === 'auto' ? {} : { source: toGoogle(source) }),
        format: 'text',
      });
      const list = data.data.translations;
      return {
        translations: list.map((t) => t.translatedText),
        detectedSource: source === 'auto' ? fromGoogle(list[0]?.detectedSourceLanguage) : null,
      };
    },

    async ocr(imageBase64) {
      const data = await call<{
        responses: { fullTextAnnotation?: { text: string }; textAnnotations?: { locale?: string }[]; error?: unknown }[];
      }>('https://vision.googleapis.com/v1/images:annotate', {
        requests: [{ image: { content: imageBase64 }, features: [{ type: 'TEXT_DETECTION' }] }],
      });
      const r = data.responses[0];
      if (!r || r.error) throw new ApiError(502, 'upstream_error', 'Could not read text from that image. You were not charged.');
      return { text: r.fullTextAnnotation?.text ?? '', detectedSource: fromGoogle(r.textAnnotations?.[0]?.locale) };
    },
  };
}
