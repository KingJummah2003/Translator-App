import { describe, expect, it } from 'vitest';
import { ALL_DIALECTS, DIALECT_NAMES_AR, dialectName, dictionarySource, orderDialects } from './dictionary';
import { LANGUAGES, getLanguage } from './languages';

describe('dictionary sources', () => {
  it('covers every app language', () => {
    for (const l of LANGUAGES) expect(dictionarySource(l.code, l.name).names.length).toBeGreaterThan(0);
  });

  it('uses Wiktionary names where they differ from the app name', () => {
    expect(dictionarySource('sl', 'Slovenian').names).toEqual(['Slovene']);
    expect(dictionarySource('sr', 'Serbian').names).toEqual(['Serbo-Croatian']);
    expect(dictionarySource('fr', 'French').names).toEqual(['French']);
  });

  it('has an Arabic name for every dialect', () => {
    for (const d of ALL_DIALECTS) expect(DIALECT_NAMES_AR[d], d).toBeTruthy();
    expect(dialectName('Gulf Arabic', 'ar')).toBe('اللهجة الخليجية');
    expect(dialectName('Gulf Arabic', 'en')).toBe('Gulf Arabic');
  });

  it("never lists an app language as another language's dialect", () => {
    const appNames = new Set(LANGUAGES.map((l) => l.name));
    for (const d of ALL_DIALECTS) expect(appNames.has(d), d).toBe(false);
  });

  it("lists the speaker's own dialect first", () => {
    expect(orderDialects('ar', 'KW')[0]).toBe('Gulf Arabic');
    expect(orderDialects('ar', 'eg')[0]).toBe('Egyptian Arabic');
    expect(orderDialects('ar', 'MA')[0]).toBe('Moroccan Arabic');
    expect(orderDialects('ar', null)).toEqual(dictionarySource('ar', 'Arabic').dialects);
    expect(new Set(orderDialects('ar', 'SA')).size).toBe(orderDialects('ar', 'SA').length);
    expect(getLanguage('ar')).toBeTruthy();
  });
});
