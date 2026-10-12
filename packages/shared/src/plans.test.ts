import { describe, expect, it } from 'vitest';
import { COSTS, PRODUCTS, PRODUCT_IDS, startOfWeekUtc } from './plans';
import { LANGUAGES, OFFLINE_LANGUAGE_CODES, canTranslateOffline } from './languages';

describe('plans', () => {
  it('charges at least one credit and rounds up', () => {
    expect(COSTS.translateText(1)).toBe(1);
    expect(COSTS.translateText(500)).toBe(1);
    expect(COSTS.translateText(501)).toBe(2);
    expect(COSTS.translateDocument(10)).toBe(5);
  });

  it('defines every product id', () => {
    for (const id of PRODUCT_IDS) expect(PRODUCTS[id].id).toBe(id);
  });

  it('puts the VIP week start on Monday 00:00 UTC', () => {
    expect(startOfWeekUtc(new Date('2026-10-11T15:00:00Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z'); // Sunday
    expect(startOfWeekUtc(new Date('2026-10-12T00:00:00Z')).toISOString()).toBe('2026-10-12T00:00:00.000Z'); // Monday
  });
});

describe('languages', () => {
  it('has unique codes and 59 offline languages', () => {
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
    expect(OFFLINE_LANGUAGE_CODES).toHaveLength(59);
  });

  it('knows which pairs work offline', () => {
    expect(canTranslateOffline('ar', 'en')).toBe(true);
    expect(canTranslateOffline('ar', 'am')).toBe(false);
  });
});
