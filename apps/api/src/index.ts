import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { REQUEST_LIMITS } from '@translator/shared';
import { auth } from './auth';
import { dailyCleanup } from './cron';
import type { AppEnv, Env } from './env';
import { ApiError } from './errors';
import { baseHeaders, ipRateLimit, requireUser, userRateLimit } from './middleware';
import { admin } from './routes/admin';
import { cloud } from './routes/cloud';
import { dictionary } from './routes/dictionary';
import { me } from './routes/me';
import { webhooks } from './routes/webhooks';

const app = new Hono<AppEnv>();

app.use('*', baseHeaders);

app.get('/health', (c) => c.json({ ok: true }));

// Request size limits, enforced while reading the body (so chunked uploads can't skip them).
const tooLarge = (c: import('hono').Context) => c.json({ error: { code: 'too_large', message: 'That request is too large.' } }, 413);
const limit = (maxSize: number) => bodyLimit({ maxSize, onError: tooLarge });
app.use('/api/auth/*', limit(16 * 1024));
app.use('/webhooks/*', limit(256 * 1024));
app.use('/admin/*', limit(64 * 1024));
app.use('/v1/documents', limit(REQUEST_LIMITS.maxDocumentBytes + 64 * 1024));
app.use('/v1/ocr', limit(Math.ceil((REQUEST_LIMITS.maxImageBytes * 4) / 3) + 16 * 1024));
app.use('/v1/translate', limit(64 * 1024));
app.use('/v1/me/*', limit(16 * 1024));

// Accounts: sign-in, sign-up, sessions, one-time codes, account deletion.
app.use('/api/auth/*', ipRateLimit);
// Better Auth's own admin endpoints (impersonate, set password...) are not used: admin work
// goes through /admin, which is behind Cloudflare Access and audited.
app.all('/api/auth/admin/*', (c) => c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404));
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// Free for everyone (signed in or not), limited per IP.
app.use('/v1/dictionary', ipRateLimit);
app.route('/v1/dictionary', dictionary);

// Signed-in features, rate limited per user by plan.
const v1 = new Hono<AppEnv>();
v1.use('*', requireUser, userRateLimit);
v1.route('/', cloud);
v1.route('/me', me);
app.route('/v1', v1);

app.route('/webhooks', webhooks);
app.route('/admin', admin);

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json(err.toBody(), err.status);
  // Never echo internal errors (they can contain SQL or provider details).
  console.error(`unhandled error ${c.get('requestId') ?? ''}: ${err instanceof Error ? err.stack : String(err)}`);
  return c.json({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    if (controller.cron === '0 3 * * *') ctx.waitUntil(dailyCleanup(env));
  },
} satisfies ExportedHandler<Env>;

export { app };
