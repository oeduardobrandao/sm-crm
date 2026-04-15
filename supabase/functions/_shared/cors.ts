/**
 * Returns CORS headers that only echo back the request origin when it is in the
 * ALLOWED_ORIGINS allowlist. Falls back to the first allowed origin for non-browser
 * requests (no Origin header).
 *
 * Set env var: ALLOWED_ORIGINS=https://app.yourdomain.com,https://hub.yourdomain.com
 */
export function buildCorsHeaders(req: Request): Record<string, string> {
  const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  const requestOrigin = req.headers.get('origin') || '';
  const corsOrigin = allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  };
}
