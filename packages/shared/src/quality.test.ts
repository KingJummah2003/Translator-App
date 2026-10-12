import { describe, expect, it } from 'vitest';
import { OFFLINE_LANGUAGE_CODES } from './languages';
import { OFFLINE_QUALITY_SCORES, offlineQualityTier } from './quality';

describe('offline quality', () => {
  it('has a score for every offline language except English', () => {
    for (const code of OFFLINE_LANGUAGE_CODES.filter((c) => c !== 'en')) expect(OFFLINE_QUALITY_SCORES[code], code).toBeTypeOf('number');
  });

  it('maps scores to tiers', () => {
    expect(offlineQualityTier('af')).toBe('good');
    expect(offlineQualityTier('ar')).toBe('fair');
    expect(offlineQualityTier('ur')).toBe('basic');
    expect(offlineQualityTier('xx')).toBe('fair');
  });
});
