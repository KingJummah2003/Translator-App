import { Hono } from 'hono';
import { auth } from './auth';
import { dailyCleanup } from './cron';
import type { AppEnv, Env } from './env';
import { ApiError } from './errors';
import { baseHeaders, ipRateLimit, requireUser, userRateLimit } from './middleware';
import { admin } from './routes/admin';
import { cloud } from './routes/cloud';
import { me } from './routes/me';
import { webhooks } from './routes/webhooks';

const app = new Hono<AppEnv>();

app.use('*', baseHeaders);

app.get('/health', (c) => c.json({ ok: true }));

// Accounts: sign-in, sign-up, sessions, one-time codes, account deletion.
app.use('/api/auth/*', ipRateLimit);
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

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
