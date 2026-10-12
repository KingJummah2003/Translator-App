/**
 * How well the on-device (ML Kit) model translates each offline language, from English.
 *
 * Scores are 0-100 from a review on 2026-10-11: two independent reviewers per language
 * rated a 40-sentence everyday corpus (greetings, travel, food, medical, money, dates,
 * business, legal, idioms, negation, names) plus a 29-paragraph CV, with a third review
 * when they disagreed by more than 15 points. Mean 57, range 42-68. Idioms fail in every
 * language (10-42) and medical wording often takes the wrong sense ("tablet" as a device,
 * "nuts" as hardware), so the app recommends cloud translation for important text.
 */
export const OFFLINE_QUALITY_SCORES: Readonly<Record<string, number>> = {
  af: 68,
  ar: 60,
  be: 51,
  bg: 58,
  bn: 48,
  ca: 63,
  cs: 56,
  cy: 65,
  da: 66,
  de: 61,
  el: 58,
  eo: 60,
  es: 64,
  et: 52,
  fa: 54,
  fi: 57,
  fr: 62,
  ga: 57,
  gl: 59,
  gu: 50,
  he: 56,
  hi: 63,
  hr: 62,
  ht: 57,
  hu: 54,
  id: 68,
  is: 51,
  it: 64,
  ja: 50,
  ka: 46,
  kn: 48,
  ko: 50,
  lt: 52,
  lv: 55,
  mk: 56,
  mr: 54,
  ms: 62,
  mt: 56,
  nl: 65,
  no: 64,
  pl: 58,
  pt: 58,
  ro: 56,
  ru: 54,
  sk: 54,
  sl: 54,
  sq: 59,
  sv: 62,
  sw: 48,
  ta: 47,
  te: 52,
  th: 62,
  tl: 60,
  tr: 57,
  uk: 54,
  ur: 42,
  vi: 64,
  zh: 58,
};

export type OfflineQuality = 'good' | 'fair' | 'basic';

/** 'good' is still machine quality: fine for everyday phrases, not for anything important. */
export function offlineQualityTier(code: string): OfflineQuality {
  const score = OFFLINE_QUALITY_SCORES[code];
  if (score === undefined) return 'fair';
  return score >= 62 ? 'good' : score >= 54 ? 'fair' : 'basic';
}
