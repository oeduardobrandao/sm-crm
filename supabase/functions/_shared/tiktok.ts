// Shared TikTok wire constants, token crypto, and the authenticated API fetch wrapper.
// Every TikTok edge function imports from here — no copy-paste of token crypto or wire
// strings anywhere else. Token crypto mirrors instagram-integration/index.ts's HKDF +
// AES-256-GCM scheme (info string parametrized per token kind), minus the legacy padEnd
// fallback branch — this is a new integration with a single scheme, nothing to migrate.

// --- Wire constants ---

export const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";
export const TIKTOK_SCOPES =
  "user.info.basic,user.info.profile,user.info.stats,video.list,video.upload,video.publish";

// sic — TikTok's official misspellings in their wire format; never "correct" these strings.
export const FIELD_PUBLIC_POST_ID = "publicaly_available_post_id";
export const EVENT_PUBLISH_COMPLETE = "post.publish.complete";
export const EVENT_PUBLISH_FAILED = "post.publish.failed";
export const EVENT_PUBLICLY_AVAILABLE = "post.publish.publicly_available";
export const EVENT_NO_LONGER_PUBLICALY_AVAILABLE = "post.publish.no_longer_publicaly_available"; // sic
export const EVENT_AUTH_REMOVED = "authorization.removed";
export const RETRYABLE_FAIL_REASONS = ["video_pull_failed", "photo_pull_failed", "internal"];

// --- Token encryption (AES-256-GCM, HKDF-derived key from TOKEN_ENCRYPTION_KEY) ---

function requireEncryptionSecret(): string {
  const secret = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!secret) {
    throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required");
  }
  return secret;
}

async function getEncryptionKey(kind: "access" | "refresh", usage: KeyUsage[]): Promise<CryptoKey> {
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
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(`tiktok-${kind}-token`) },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

export async function encryptTikTokToken(raw: string, kind: "access" | "refresh"): Promise<string> {
  const key = await getEncryptionKey(kind, ["encrypt"]);
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(raw));
  const encryptedArray = new Uint8Array(encryptedBuf);
  const combined = new Uint8Array(iv.length + encryptedArray.length);
  combined.set(iv);
  combined.set(encryptedArray, iv.length);
  return btoa(String.fromCharCode.apply(null, Array.from(combined)));
}

export async function decryptTikTokToken(enc: string, kind: "access" | "refresh"): Promise<string> {
  const combined = Uint8Array.from(atob(enc), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const key = await getEncryptionKey(kind, ["decrypt"]);
  const decryptedBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decryptedBuf);
}

// --- API fetch wrapper ---

interface TikTokErrorBody {
  code?: string;
  message?: string;
  log_id?: string;
}

interface TikTokEnvelope {
  data?: unknown;
  error?: TikTokErrorBody;
}

/** Thrown by tiktokFetch for both transport-level and TikTok-envelope errors. */
export class TikTokApiError extends Error {
  code: string;
  retryable: boolean;

  constructor(message: string, code: string, retryable = false) {
    super(message);
    this.name = "TikTokApiError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Authenticated fetch against the TikTok API. Parses TikTok's response envelope
 * (`{ data, error: { code, message, log_id } }`, where `code === "ok"` means success)
 * and throws a typed TikTokApiError on any failure:
 *  - `access_token_invalid` -> code "TOKEN_INVALID"
 *  - scope errors (`scope_*`) -> code "REVOKED"
 *  - HTTP 429 -> retryable code "RATE_LIMITED"
 *  - anything else -> TikTok's own error code, non-retryable
 * Returns the envelope's `data` field on success.
 */
export async function tiktokFetch(
  path: string,
  init: RequestInit & { accessToken: string },
): Promise<unknown> {
  const { accessToken, headers, ...rest } = init;
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Authorization", `Bearer ${accessToken}`);
  if (!requestHeaders.has("Content-Type") && rest.body) {
    requestHeaders.set("Content-Type", "application/json; charset=UTF-8");
  }

  const response = await fetch(`${TIKTOK_API_BASE}${path}`, { ...rest, headers: requestHeaders });

  if (response.status === 429) {
    throw new TikTokApiError("TikTok API rate limit exceeded", "RATE_LIMITED", true);
  }

  let body: TikTokEnvelope;
  try {
    body = await response.json();
  } catch {
    throw new TikTokApiError(
      `Failed to parse TikTok API response (status ${response.status})`,
      "REQUEST_FAILED",
      false,
    );
  }

  const errorCode = body?.error?.code;
  if (errorCode && errorCode !== "ok") {
    const message = body.error?.message || errorCode;
    if (errorCode === "access_token_invalid") {
      throw new TikTokApiError(message, "TOKEN_INVALID", false);
    }
    if (errorCode.startsWith("scope_")) {
      throw new TikTokApiError(message, "REVOKED", false);
    }
    throw new TikTokApiError(message, errorCode, false);
  }

  return body?.data ?? body;
}
