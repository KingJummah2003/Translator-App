import { Hono } from 'hono';
import { dictionarySource, getLanguage, isLanguageCode, type DictionarySense } from '@translator/shared';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';

/**
 * Word definitions from English Wiktionary (thousands of languages, CC BY-SA). The app
 * calls us instead of Wikimedia directly so the user's IP never reaches a third party.
 * Responses are cached at the edge for a day; looked-up words are never logged.
 *
 * Senses are matched by Wiktionary language name (see packages/shared/src/dictionary.ts),
 * so languages filed under the REST "other" key work, and dialect entries (Gulf Arabic,
 * Bavarian, Neapolitan, ...) come back labelled after the standard-language senses.
 */
export const dictionary = new Hono<AppEnv>();

export type { DictionarySense };

type RestEntry = { partOfSpeech: string; language: string; definitions: { definition: string; examples?: string[] }[] };
type RestResponse = Record<string, RestEntry[]>;

const MAX_STANDARD_SENSES = 8;
const MAX_DIALECT_SENSES = 8;

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
 * German and Luxembourgish nouns are capitalised headwords (Haus), other words are not.
 */
export function lookupCandidates(word: string, lang: string): string[] {
  const clean = word.normalize('NFC').replace(/[ً-ْـ]/g, ''); // Arabic diacritics and tatweel
  const out = [word, clean, clean.toLowerCase()];
  if (lang === 'de' || lang === 'lb') out.push(clean.charAt(0).toUpperCase() + clean.slice(1));
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

/**
 * Picks this language's senses (and its dialects') out of a REST response, wherever the
 * endpoint filed them. Standard senses come first, then dialects in map order.
 */
export function selectSenses(data: RestResponse, code: string): DictionarySense[] {
  const { names, dialects } = dictionarySource(code, getLanguage(code)?.name ?? code);
  const entries = Object.values(data).flat();
  const toSense = (e: RestEntry, dialect?: string): DictionarySense => ({
    partOfSpeech: e.partOfSpeech ?? '',
    language: e.language,
    ...(dialect ? { dialect } : {}),
    definitions: (e.definitions ?? [])
      .map((d) => ({
        text: strip(d.definition ?? ''),
        // Some "examples" are only category-link markup and strip to nothing.
        examples: (d.examples ?? []).map(strip).filter(Boolean).slice(0, 2),
      }))
      .filter((d) => d.text)
      .slice(0, 6),
  });

  const standard = names
    .flatMap((name) => entries.filter((e) => e.language === name))
    .map((e) => toSense(e))
    .filter((s) => s.definitions.length)
    .slice(0, MAX_STANDARD_SENSES);
  const regional = dialects
    .flatMap((name) => entries.filter((e) => e.language === name).map((e) => toSense(e, name)))
    .filter((s) => s.definitions.length)
    .slice(0, MAX_DIALECT_SENSES);
  return [...standard, ...regional];
}

/** Simplified Chinese headwords are soft redirects ({{zh-see|謝謝}}) with no definitions. */
export function zhSeeTarget(wikitext: string): string | null {
  return /\{\{zh-see\|([^|}]+)/.exec(wikitext)?.[1]?.trim() ?? null;
}

async function fetchDefinitions(word: string, userAgent: string): Promise<RestResponse | null> {
  const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, {
    headers: { 'user-agent': userAgent, accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (res.status === 429) throw new ApiError(503, 'upstream_error', 'The dictionary is busy. Try again in a moment.');
  if (!res.ok) throw new ApiError(502, 'upstream_error', 'The dictionary is unavailable right now.');
  return res.json<RestResponse>();
}

async function fetchZhRedirect(word: string, userAgent: string): Promise<string | null> {
  const url = `https://en.wiktionary.org/w/api.php?action=parse&format=json&formatversion=2&prop=wikitext&page=${encodeURIComponent(word)}`;
  const res = await fetch(url, { headers: { 'user-agent': userAgent, accept: 'application/json' } });
  if (!res.ok) return null;
  const body = await res.json<{ parse?: { wikitext?: string } }>();
  const target = zhSeeTarget(body.parse?.wikitext ?? '');
  return target && target !== word ? target : null;
}

dictionary.get('/', async (c) => {
  const word = (c.req.query('word') ?? '').trim();
  const lang = c.req.query('lang') ?? '';
  if (!word || word.length > 64 || /[\/?#]/.test(word)) throw new ApiError(400, 'bad_request', 'Invalid word.');
  if (!isLanguageCode(lang)) throw new ApiError(400, 'bad_request', 'Unsupported language.');

  const cacheKey = new Request(`https://cache.internal/dictionary/v3/${lang}/${encodeURIComponent(word.toLowerCase())}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit) return new Response(hit.body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

  const userAgent = `TranslatorApp/2.0 (${c.env.API_URL})`;
  const base = lang.split('-')[0]!;
  let senses: DictionarySense[] = [];
  for (const candidate of lookupCandidates(word, base)) {
    const data = await fetchDefinitions(candidate, userAgent);
    if (data) senses = selectSenses(data, lang);
    if (senses.length) break;
  }
  if (!senses.length && base === 'zh') {
    const target = await fetchZhRedirect(word, userAgent);
    const data = target ? await fetchDefinitions(target, userAgent) : null;
    if (data) senses = selectSenses(data, lang);
  }

  const body = JSON.stringify({ word, lang, senses, source: 'Wiktionary (CC BY-SA 4.0)' });
  // The edge copy is shared and cached ("not found" only briefly, so new entries show up).
  // Phones are told not to cache: the app keeps its own encrypted copy of looked-up words.
  const shared = new Response(body, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${senses.length ? 86400 : 3600}` },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, shared));
  return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
});
