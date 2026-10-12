/**
 * Serves the admin portal and forwards /api/* to the API Worker's /admin/* routes over a
 * service binding (no public hop). Cloudflare Access protects this whole hostname; the
 * API re-verifies the Access token it receives in Cf-Access-Jwt-Assertion.
 */
interface Env {
  ASSETS: Fetcher;
  API: Fetcher;
}

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let res: Response;
    if (url.pathname.startsWith('/api/')) {
      const target = new URL(url.pathname.replace(/^\/api/, '/admin') + url.search, 'https://api.internal');
      res = await env.API.fetch(new Request(target, request));
    } else {
      res = await env.ASSETS.fetch(request);
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },
} satisfies ExportedHandler<Env>;
