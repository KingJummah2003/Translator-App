import type { Tier } from '@translator/shared';
import { ApiError } from './errors';

/**
 * Cost protection and usage metering. Only counts are stored (requests, characters,
 * credits) — never the text itself.
 */

export type Action = 'translate' | 'ocr' | 'document';

export interface Settings {
  /** Admin kill switch: stops all cloud calls immediately. */
  servicePaused: boolean;
  /** Maximum characters sent to the provider per UTC day across all users (0 = no cap). */
  globalDailyCharCap: number;
  /** Maximum OCR images per UTC day across all users (0 = no cap). */
  globalDailyOcrCap: number;
  /** Maximum characters per UTC day for free accounts combined (0 = no cap). */
  freeDailyCharCap: number;
}

export const DEFAULT_SETTINGS: Settings = {
  servicePaused: false,
  globalDailyCharCap: 20_000_000,
  globalDailyOcrCap: 20_000,
  freeDailyCharCap: 2_000_000,
};

let cached: { at: number; value: Settings } | null = null;
const CACHE_MS = 15_000;

export async function getSettings(db: D1Database, now = Date.now()): Promise<Settings> {
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const { results } = await db.prepare('SELECT key, value FROM app_setting').all<{ key: string; value: string }>();
  const map = new Map(results.map((r) => [r.key, r.value]));
  const value: Settings = {
    servicePaused: map.get('service_paused') === '1',
    globalDailyCharCap: Number(map.get('global_daily_char_cap') ?? DEFAULT_SETTINGS.globalDailyCharCap),
    globalDailyOcrCap: Number(map.get('global_daily_ocr_cap') ?? DEFAULT_SETTINGS.globalDailyOcrCap),
    freeDailyCharCap: Number(map.get('free_daily_char_cap') ?? DEFAULT_SETTINGS.freeDailyCharCap),
  };
  cached = { at: now, value };
  return value;
}

export function clearSettingsCache(): void {
  cached = null;
}

/** Refuses the request before any money is spent if the service is paused or over budget. */
export async function assertWithinBudget(db: D1Database, action: Action, chars: number, tier: Tier, now = Date.now()) {
  const settings = await getSettings(db, now);
  if (settings.servicePaused) {
    throw new ApiError(503, 'service_paused', 'Cloud translation is paused for maintenance. Offline translation still works.');
  }
  const today = await db
    .prepare('SELECT chars, ocr_images, free_chars FROM usage_global_daily WHERE day = ?')
    .bind(day(now))
    .first<{ chars: number; ocr_images: number; free_chars: number }>();
  const overChars = settings.globalDailyCharCap > 0 && (today?.chars ?? 0) + chars > settings.globalDailyCharCap;
  const overOcr = action === 'ocr' && settings.globalDailyOcrCap > 0 && (today?.ocr_images ?? 0) >= settings.globalDailyOcrCap;
  const overFree = tier === 'free' && settings.freeDailyCharCap > 0 && (today?.free_chars ?? 0) + chars > settings.freeDailyCharCap;
  if (overChars || overOcr || overFree) {
    console.warn(`daily cap reached for ${action} (${overFree ? 'free tier' : 'global'})`);
    throw new ApiError(503, 'service_paused', 'Cloud translation is busy right now. Offline translation still works.');
  }
}

export function recordUsage(
  db: D1Database,
  userId: string,
  action: Action,
  chars: number,
  credits: number,
  tier: Tier,
  now = Date.now(),
): Promise<D1Result[]> {
  const d = day(now);
  return db.batch([
    db
      .prepare(
        `INSERT INTO usage_daily (day, user_id, action, requests, chars, credits) VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT (day, user_id, action) DO UPDATE SET
           requests = requests + 1, chars = chars + excluded.chars, credits = credits + excluded.credits`,
      )
      .bind(d, userId, action, chars, credits),
    db
      .prepare(
        `INSERT INTO usage_global_daily (day, requests, chars, credits, ocr_images, free_chars) VALUES (?, 1, ?, ?, ?, ?)
         ON CONFLICT (day) DO UPDATE SET
           requests = requests + 1, chars = chars + excluded.chars, credits = credits + excluded.credits,
           ocr_images = ocr_images + excluded.ocr_images, free_chars = free_chars + excluded.free_chars`,
      )
      .bind(d, chars, credits, action === 'ocr' ? 1 : 0, tier === 'free' ? chars : 0),
  ]);
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
