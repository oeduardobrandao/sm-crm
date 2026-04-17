import { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Check rate limit using DB-backed counter.
 * Returns true if request is allowed, false if rate-limited.
 */
export async function checkRateLimit(
  db: SupabaseClient,
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const { data, error } = await db.rpc('check_rate_limit', {
    p_key: key,
    p_max_requests: maxRequests,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error('[rate-limit] RPC error:', error.message);
    return true; // fail open to avoid blocking legitimate traffic
  }
  return data === true;
}

/**
 * Extract client IP from request headers (works behind Vercel/Cloudflare proxy).
 */
export function getClientIP(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
}
