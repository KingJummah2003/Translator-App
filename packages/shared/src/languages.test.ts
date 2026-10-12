import { describe, expect, it } from 'vitest';
import { LANGUAGES, getLanguage } from './languages';

const ARABIC_LETTERS = /^[\u0621-\u064a\u0651\u0670 ()]+$/;

describe('languages', () => {
  it('has 133 languages with unique codes', () => {
    expect(LANGUAGES).toHaveLength(133);
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
  });

  it('gives every language an Arabic name written in Arabic script', () => {
    for (const l of LANGUAGES) {
      expect(l.nameAr, l.code).toBeTypeOf('string');
      expect(l.nameAr.trim(), l.code).toBe(l.nameAr);
      expect(l.nameAr, l.code).toMatch(ARABIC_LETTERS);
    }
  });

  it('keeps Arabic names distinct', () => {
    const seen = new Map<string, string>();
    for (const l of LANGUAGES) {
      expect(seen.get(l.nameAr), `${l.code} repeats ${l.nameAr}`).toBeUndefined();
      seen.set(l.nameAr, l.code);
    }
  });

  it('keeps English names distinct', () => {
    expect(new Set(LANGUAGES.map((l) => l.name)).size).toBe(LANGUAGES.length);
  });

  it('uses the expected Arabic names for common languages', () => {
    expect(getLanguage('en')?.nameAr).toBe('الإنجليزية');
    expect(getLanguage('ar')?.nameAr).toBe('العربية');
    expect(getLanguage('fr')?.nameAr).toBe('الفرنسية');
    expect(getLanguage('zh')?.nameAr).toBe('الصينية (المبسّطة)');
    expect(getLanguage('zh-TW')?.nameAr).toBe('الصينية (التقليدية)');
  });
});
