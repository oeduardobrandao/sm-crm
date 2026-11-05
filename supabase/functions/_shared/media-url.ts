const WORKER_URL = Deno.env.get("MEDIA_WORKER_URL") ?? "";
const SIGNING_KEY = Deno.env.get("MEDIA_SIGNING_KEY") ?? "";

const encoder = new TextEncoder();

async function hmacSign(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Expiry rounded UP to the next multiple of `expiresIn`, so every signing of
 * the same key inside one window yields the same URL. The worker answers with
 * `immutable` for a year, but the browser caches by full URL: with `now +
 * expiresIn` to the second, each API response minted a new URL and every image
 * view became a fresh Worker request (blew the 100k/day Workers free quota).
 * The URL stays valid for at least `expiresIn` and less than `2 * expiresIn`.
 */
export function bucketedExpiry(nowSeconds: number, expiresIn: number): number {
  return Math.ceil((nowSeconds + expiresIn) / expiresIn) * expiresIn;
}

/**
 * Generates a signed media URL pointing at the Cloudflare Worker proxy.
 * Falls back to R2 presigned URL if MEDIA_WORKER_URL is not configured.
 */
export async function signMediaUrl(
  r2Key: string,
  expiresIn = 604_800, // 7 days default
): Promise<string> {
  if (!WORKER_URL || !SIGNING_KEY) return null as unknown as string;
  const exp = bucketedExpiry(Math.floor(Date.now() / 1000), expiresIn);
  const sig = await hmacSign(SIGNING_KEY, `${r2Key}:${exp}`);
  return `${WORKER_URL}/${encodeURIComponent(r2Key)}?exp=${exp}&sig=${sig}`;
}

export function isMediaProxyEnabled(): boolean {
  return Boolean(WORKER_URL && SIGNING_KEY);
}
