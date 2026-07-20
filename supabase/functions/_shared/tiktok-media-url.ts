// supabase/functions/_shared/tiktok-media-url.ts
//
// tiktok-media fast-follow: builds and verifies signed, time-limited proxy URLs for
// TikTok-bound media. TikTok's PULL_FROM_URL source requires media URLs under a
// TikTok-verifiable URL prefix; our R2 presigned URLs (raw *.r2.cloudflarestorage.com) can't
// be verified by TikTok's URL-prefix registration (not our domain, private bucket). This puts
// TikTok-bound media behind our own function host instead: buildTikTokMediaUrl mints
// `${SUPABASE_URL}/functions/v1/tiktok-media/m/{payloadB64}.{sig}`, and the tiktok-media edge
// function (index.ts/handler.ts) resolves that token back to an r2Key via verifyTikTokMediaToken
// before proxying the actual R2 GET server-side.
//
// Token shape: base64url(JSON{k: r2Key, exp: unixSeconds}) + "." + base64url(HMAC-SHA256 over
// the payloadB64 STRING — not the decoded bytes). Key derivation mirrors _shared/tiktok.ts's
// HKDF pattern (SHA-256, empty salt) off TOKEN_ENCRYPTION_KEY, but with its own info string
// ('tiktok-media-url') so this key is cryptographically independent of the AES-GCM keys
// _shared/tiktok.ts derives for access/refresh token encryption — a compromise of one never
// implicates the other. TOKEN_ENCRYPTION_KEY is read lazily (inside getHmacKey, not at module
// load) and throws if missing, same contract as _shared/tiktok.ts's requireEncryptionSecret.
//
// verifyTikTokMediaToken never throws on a malformed/tampered/expired token — every failure
// path (bad shape, undecodable base64, invalid signature, expired) returns null so callers
// (the proxy route) can uniformly answer 403 without a try/catch of their own. Signature
// verification goes through crypto.subtle.verify (inherently constant-time) rather than a
// manual byte compare.

function requireEncryptionSecret(): string {
  const secret = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!secret) {
    throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required");
  }
  return secret;
}

function requireSupabaseUrl(): string {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) {
    throw new Error("SUPABASE_URL environment variable is required");
  }
  return url;
}

async function getHmacKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const secret = requireEncryptionSecret();
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HKDF" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("tiktok-media-url") },
    baseKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    usage,
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface TikTokMediaTokenPayload {
  k: string;
  exp: number;
}

/** Mints a signed, time-limited proxy URL for TikTok-bound media — see module comment for the
 * exact token shape and why this exists instead of a raw R2 presigned URL. */
export async function buildTikTokMediaUrl(r2Key: string, ttlSeconds: number): Promise<string> {
  const supabaseUrl = requireSupabaseUrl();

  const payload: TikTokMediaTokenPayload = {
    k: r2Key,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));

  const key = await getHmacKey(["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const sig = base64UrlEncode(new Uint8Array(sigBuf));

  return `${supabaseUrl}/functions/v1/tiktok-media/m/${payloadB64}.${sig}`;
}

/** Verifies a token minted by buildTikTokMediaUrl and returns the r2Key it carries, or null if
 * the token is malformed, tampered (payload OR signature), or expired. Never throws on bad
 * input — a missing TOKEN_ENCRYPTION_KEY is the one exception, since that's a deployment
 * misconfiguration rather than a per-request condition (matches _shared/tiktok.ts's own
 * lazy-read-and-throw contract). */
export async function verifyTikTokMediaToken(token: string): Promise<string | null> {
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const payloadB64 = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  if (!payloadB64 || !sig) return null;

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlDecode(sig);
  } catch {
    return null;
  }

  const key = await getHmacKey(["verify"]);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes as BufferSource,
    new TextEncoder().encode(payloadB64),
  );
  if (!valid) return null;

  let payload: TikTokMediaTokenPayload;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payloadB64));
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (!payload || typeof payload.k !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload.k;
}
