import { disambiguate, expandContractions, joinSegments, normalizeTimes, protectForTranslation, splitSentences } from './rules';

export {
  disambiguate,
  expandContractions,
  joinSegments,
  normalizeTimes,
  protectForTranslation,
  protectTerms,
  splitSentences,
  type Segment,
} from './rules';

/**
 * Rewrites one English sentence into plainer English that small on-device models translate
 * reliably: contractions are spelled out (negations survive), risky words get their
 * unambiguous sense, and 12-hour times become 24-hour. (An idiom table is planned.)
 */
export function preEditEnglish(sentence: string, target: string): string {
  let s = expandContractions(sentence);
  s = disambiguate(s);
  if (target !== 'en') s = normalizeTimes(s);
  return s;
}

/**
 * Machine translation with the pre-editing layer: the text is split into sentences, English
 * sentences are pre-edited, names, products, emails, links and numbers are shielded with
 * placeholders, and each sentence is translated on its own. A sentence whose placeholders do
 * not survive is retried without them, so a result is always returned.
 */
export async function translateEnhanced(
  text: string,
  from: string,
  to: string,
  translate: (text: string) => Promise<string>,
): Promise<string> {
  const segments = splitSentences(text);
  const out = [];
  for (const segment of segments) {
    if (!segment.text.trim()) {
      out.push(segment);
      continue;
    }
    const source = from === 'en' ? preEditEnglish(segment.text, to) : segment.text;
    const shielded = protectForTranslation(source);
    const restored = shielded.restore(await translate(shielded.text));
    out.push({ text: restored ?? (await translate(source)), sep: segment.sep });
  }
  return joinSegments(out);
}
