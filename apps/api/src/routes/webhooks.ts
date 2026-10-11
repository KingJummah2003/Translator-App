import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { forgetTier } from '../middleware';
import { handleEvent, type RevenueCatEvent } from '../revenuecat';

export const webhooks = new Hono<AppEnv>();

/**
 * RevenueCat → us. Authenticated with the Authorization header value configured in the
 * RevenueCat dashboard (compared in constant time). Each event id is applied once.
 */
webhooks.post('/revenuecat', async (c) => {
  const expected = c.env.REVENUECAT_WEBHOOK_AUTH;
  const given = c.req.header('authorization') ?? '';
  if (!expected || !(await safeEqual(given, expected))) throw new ApiError(401, 'unauthorized', 'Bad webhook credentials.');

  const body = await c.req.json<{ event?: RevenueCatEvent }>().catch(() => null);
  const event = body?.event;
  if (!event?.id || !event.type) throw new ApiError(400, 'bad_request', 'Missing event.');

  const seen = await c.env.DB.prepare('SELECT status FROM webhook_event WHERE id = ?').bind(event.id).first<{ status: string }>();
  if (seen && seen.status !== 'failed') return c.json({ ok: true, duplicate: true });

  let status: 'processed' | 'ignored' | 'failed' = 'failed';
  let error: string | null = null;
  try {
    status = await handleEvent(c.env, event);
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 500) : 'unknown error';
    console.error(`revenuecat event ${event.id} (${event.type}) failed: ${error}`);
  }
  await c.env.DB.prepare(
    `INSERT INTO webhook_event (id, type, app_user_id, status, error, received_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = excluded.status, error = excluded.error, received_at = excluded.received_at`,
  )
    .bind(event.id, event.type, event.app_user_id ?? null, status, error, Date.now())
    .run();
  if (event.app_user_id) forgetTier(event.app_user_id);

  // A non-2xx makes RevenueCat retry later (5 times over ~2.5 hours).
  if (status === 'failed') return c.json({ ok: false }, 500);
  return c.json({ ok: true, status });
});

async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}
