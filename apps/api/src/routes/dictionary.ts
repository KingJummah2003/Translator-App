import { Hono } from 'hono';
import { isLanguageCode } from '@translator/shared';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';

/**
 * Word definitions from English Wiktionary (thousands of languages, CC BY-SA). The app
 * calls us instead of Wikimedia directly so the user's IP never reaches a third party.
 * Responses are cached at the edge for a day; looked-up words are never logged.
 */
export const dictionary = new Hono<AppEnv>();

export interface DictionarySense {
  partOfSpeech: string;
  definitions: { text: string; examples: string[] }[];
}

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Dictionary headwords are base forms. Arabic and Hebrew attach the article and short
 * prepositions to the word itself (القطار = ال + قطار, הבית = ה + בית), so try those too.
 */
export function lookupCandidates(word: string, lang: string): string[] {
  const clean = word.normalize('NFC').replace(/[\u064B-\u0652\u0640]/g, ''); // Arabic diacritics and tatweel
  const out = [word, clean, clean.toLowerCase()];
  if (lang === 'ar' || lang === 'fa' || lang === 'ur') {
    for (const prefix of ['وال', 'بال', 'فال', 'كال', 'لل', 'ال', 'و', 'ب', 'ل', 'ف', 'ك']) {
      if (clean.startsWith(prefix) && clean.length - prefix.length >= 2) out.push(clean.slice(prefix.length));
    }
  }
  if (lang === 'he' && clean.length > 2) {
    for (const prefix of ['וה', 'שה', 'ה', 'ו', 'ב', 'ל', 'מ', 'ש']) {
      if (clean.startsWith(prefix) && clean.length - prefix.length >= 2) out.push(clean.slice(prefix.length));
    }
  }
  return [...new Set(out)].slice(0, 5);
}

dictionary.get('/', async (c) => {
  const word = (c.req.query('word') ?? '').trim();
  const lang = c.req.query('lang') ?? '';
  if (!word || word.length > 64 || /[\/?#]/.test(word)) throw new ApiError(400, 'bad_request', 'Invalid word.');
  if (!isLanguageCode(lang)) throw new ApiError(400, 'bad_request', 'Unsupported language.');

  const wiktLang = lang === 'zh-TW' ? 'zh' : lang === 'tl' ? 'tl' : lang.split('-')[0]!;
  const cacheKey = new Request(`https://cache.internal/dictionary/v2/${wiktLang}/${encodeURIComponent(word.toLowerCase())}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit) return new Response(hit.body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

  let senses: DictionarySense[] = [];
  for (const candidate of lookupCandidates(word, wiktLang)) {
    const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(candidate)}`, {
      headers: { 'user-agent': `TranslatorApp/2.0 (${c.env.API_URL})`, accept: 'application/json' },
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new ApiError(502, 'upstream_error', 'The dictionary is unavailable right now.');
    const data = await res.json<Record<string, { partOfSpeech: string; definitions: { definition: string; examples?: string[] }[] }[]>>();
    senses = (data[wiktLang] ?? []).map((s) => ({
      partOfSpeech: s.partOfSpeech,
      definitions: s.definitions
        .map((d) => ({ text: strip(d.definition), examples: (d.examples ?? []).slice(0, 2).map(strip) }))
        .filter((d) => d.text)
        .slice(0, 6),
    }));
    if (senses.length) break;
  }

  const body = JSON.stringify({ word, lang, senses, source: 'Wiktionary (CC BY-SA 4.0)' });
  // The edge copy is shared and cached ("not found" only briefly, so new entries show up).
  // Phones are told not to cache: the app keeps its own encrypted copy of looked-up words.
  const shared = new Response(body, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${senses.length ? 86400 : 3600}` },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, shared));
  const response = new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  return response;
});
