/**
 * Returns CORS headers that only echo back the request origin when it is in the
 * ALLOWED_ORIGINS allowlist. Falls back to the first allowed origin for non-browser
 * requests (no Origin header).
 *
 * Set env var: ALLOWED_ORIGINS=https://app.yourdomain.com,https://hub.yourdomain.com
 */
function parseAllowedOrigins(): string[] {
  return (Deno.env.get('ALLOWED_ORIGINS') || 'http://localhost:5173,http://localhost:5174,http://localhost:5175')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * The request's Origin if it is in the ALLOWED_ORIGINS allowlist, else the first allowed
 * origin (for non-browser requests or untrusted origins). Always an allowlisted, valid
 * absolute URL — safe to use as a redirect base (e.g. Stripe success_url/return_url).
 */
export function resolveAllowedOrigin(req: Request): string {
  const allowed = parseAllowedOrigins();
  const requestOrigin = req.headers.get('origin') || '';
  return allowed.includes(requestOrigin) ? requestOrigin : allowed[0];
}

export function buildCorsHeaders(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': resolveAllowedOrigin(req),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  };
}
