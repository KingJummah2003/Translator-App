import { describe, expect, it } from 'vitest';
import { lookupCandidates } from '../src/routes/dictionary';

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
