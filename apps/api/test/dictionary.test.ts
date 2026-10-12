import { describe, expect, it } from 'vitest';
import { lookupCandidates, selectSenses, zhSeeTarget } from '../src/routes/dictionary';

describe('dictionary lookup candidates', () => {
  it('tries the Arabic base word without the article, prefixes and diacritics', () => {
    expect(lookupCandidates('القطار', 'ar')).toContain('قطار');
    expect(lookupCandidates('وبالكتاب', 'ar')).toContain('بالكتاب');
    expect(lookupCandidates('كِتَابٌ', 'ar')).toContain('كتاب');
  });

  it('tries the Hebrew word without the article', () => {
    expect(lookupCandidates('הבית', 'he')).toContain('בית');
  });

  it('keeps other languages simple', () => {
    expect(lookupCandidates('Bonjour', 'fr')).toEqual(['Bonjour', 'bonjour']);
  });
});

describe('dictionary sense selection', () => {
  const entry = (language: string, definition: string, examples: string[] = []) => ({
    partOfSpeech: 'Noun',
    language,
    definitions: [{ definition, examples }],
  });

  it('puts the standard language first and labels dialect entries', () => {
    const senses = selectSenses(
      {
        ar: [entry('Arabic', 'water')],
        other: [entry('Gulf Arabic', 'a lot'), entry('Persian', 'not Arabic'), entry('Iraqi Arabic', 'how are you')],
      },
      'ar',
    );
    expect(senses.map((s) => [s.language, s.dialect])).toEqual([
      ['Arabic', undefined],
      ['Gulf Arabic', 'Gulf Arabic'],
      ['Iraqi Arabic', 'Iraqi Arabic'],
    ]);
  });

  it('finds languages the endpoint files under "other"', () => {
    const data = { other: [entry('Norwegian Bokmål', 'house'), entry('Norwegian Nynorsk', 'house'), entry('Danish', 'house')] };
    expect(selectSenses(data, 'no').map((s) => s.language)).toEqual(['Norwegian Bokmål', 'Norwegian Nynorsk']);
    expect(selectSenses({ other: [entry('Slovene', 'bread')] }, 'sl')).toHaveLength(1);
    expect(selectSenses({ other: [entry('Māori', 'water')] }, 'mi')).toHaveLength(1);
  });

  it('maps Serbian, Croatian and Bosnian to Serbo-Croatian', () => {
    const data = { sh: [entry('Serbo-Croatian', 'bread')] };
    for (const code of ['sr', 'hr', 'bs']) expect(selectSenses(data, code)).toHaveLength(1);
  });

  it('drops Translingual entries, empty definitions and markup-only examples', () => {
    const senses = selectSenses(
      { en: [entry('Translingual', 'ISO code'), entry('English', '<b>water</b>', ['<link rel="mw:PageProp/Category">', 'a glass of water']), entry('English', '<span></span>')] },
      'en',
    );
    expect(senses).toHaveLength(1);
    expect(senses[0]!.definitions[0]).toEqual({ text: 'water', examples: ['a glass of water'] });
  });

  it('follows Simplified Chinese soft redirects', () => {
    expect(zhSeeTarget('{{zh-see|謝謝}}')).toBe('謝謝');
    expect(zhSeeTarget('==Chinese==')).toBeNull();
  });

  it('tries the capitalised form for German nouns', () => {
    expect(lookupCandidates('haus', 'de')).toContain('Haus');
  });
});
