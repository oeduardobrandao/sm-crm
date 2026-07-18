// Shared TikTok wire constants, token crypto, and the authenticated API fetch wrapper.
// Every TikTok edge function imports from here — no copy-paste of token crypto or wire
// strings anywhere else. Token crypto mirrors instagram-integration/index.ts's HKDF +
// AES-256-GCM scheme (info string parametrized per token kind), minus the legacy padEnd
// fallback branch — this is a new integration with a single scheme, nothing to migrate.

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

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

// --- Status-fetch wire constants (POST /v2/post/publish/status/fetch/) ---
export const STATUS_PROCESSING_UPLOAD = "PROCESSING_UPLOAD";
export const STATUS_PROCESSING_DOWNLOAD = "PROCESSING_DOWNLOAD";
export const STATUS_PUBLISH_COMPLETE = "PUBLISH_COMPLETE";
export const STATUS_FAILED = "FAILED";
// Only occurs in TikTok's "inbox" draft-posting mode (video.upload scope), which this
// integration never uses (direct-post only). Mapped for completeness/safety in case a
// stray status-fetch response ever reports it.
export const STATUS_SEND_TO_USER_INBOX = "SEND_TO_USER_INBOX";

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
    if (errorCode === "scope_not_authorized") {
      throw new TikTokApiError(message, "REVOKED", false);
    }
    throw new TikTokApiError(message, errorCode, false);
  }

  return body?.data ?? body;
}

// --- Rotation-safe token freshness ---
//
// TikTok access tokens live 24h; refresh tokens rotate — every refresh response can carry a
// NEW refresh_token, and the old one may stop working immediately. If two processes refresh
// concurrently, one persists a stale refresh token and permanently bricks the account's auth.
// getFreshTikTokToken is the ONLY code path allowed to read/refresh TikTok tokens: it serializes
// refreshes per account via an atomic claim UPDATE on `refresh_lock_at` (60s stale window, since
// supabase-js can't hold a cross-request `SELECT ... FOR UPDATE`), persists the rotated token
// BEFORE returning, and releases the lock in a `finally` on every path (success, TikTok error,
// thrown exception). Losing the claim race polls the row instead of refreshing again.

/** Access token is refreshed once fewer than this many ms remain before expiry. */
const ACCESS_TOKEN_FRESHNESS_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/** A refresh claim older than this is treated as abandoned (crashed process) and re-claimable. */
const REFRESH_LOCK_STALE_MS = 60 * 1000; // 60 seconds

const REFRESH_LOCK_POLL_ATTEMPTS = 3;
const REFRESH_LOCK_POLL_INTERVAL_MS = 2000;

interface TikTokAccountFreshnessRow {
  id: string;
  tiktok_open_id: string;
  encrypted_access_token: string | null;
  access_token_expires_at: string | null;
}

interface TikTokAccountClaimRow {
  id: string;
  encrypted_refresh_token: string | null;
  tiktok_open_id: string;
}

interface TikTokRefreshSuccessBody {
  open_id: string;
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  scope?: string;
  token_type?: string;
}

interface TikTokRefreshErrorBody {
  error: string;
  error_description?: string;
  log_id?: string;
}

/** Exported for tiktok-integration's OAuth callback/disconnect (token exchange, revoke) —
 * the same lazy-read-and-throw credential lookup, no copy-paste of the error message. */
export function requireTikTokClientCredentials(): { clientKey: string; clientSecret: string } {
  const clientKey = Deno.env.get("TIKTOK_CLIENT_KEY");
  const clientSecret = Deno.env.get("TIKTOK_CLIENT_SECRET");
  if (!clientKey || !clientSecret) {
    throw new Error("TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET environment variables are required");
  }
  return { clientKey, clientSecret };
}

function isAccessTokenFresh(expiresAt: string | null, now: number): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - now > ACCESS_TOKEN_FRESHNESS_WINDOW_MS;
}

async function decryptFreshAccount(
  row: TikTokAccountFreshnessRow,
): Promise<{ accessToken: string; openId: string }> {
  if (!row.encrypted_access_token) {
    throw new TikTokApiError("TikTok account has no access token on file", "TOKEN_EXPIRED", false);
  }
  const accessToken = await decryptTikTokToken(row.encrypted_access_token, "access");
  return { accessToken, openId: row.tiktok_open_id };
}

export interface GetFreshTikTokTokenOptions {
  /**
   * Injected sleep for lock-contention polling — smallest seam that lets tests exercise the
   * 3x-poll path without burning real 2s waits. Defaults to a real setTimeout-based sleep.
   */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The ONLY code path that reads or refreshes TikTok tokens. Returns a live access token,
 * refreshing it first when fewer than 30 minutes remain before expiry. See the module-level
 * comment above for why the refresh is serialized per account via an atomic claim lock.
 */
export async function getFreshTikTokToken(
  svc: SupabaseClient,
  accountId: string,
  opts: GetFreshTikTokTokenOptions = {},
): Promise<{ accessToken: string; openId: string }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const { data: account } = await svc
    .from("tiktok_accounts")
    .select("id, tiktok_open_id, encrypted_access_token, access_token_expires_at")
    .eq("id", accountId)
    .maybeSingle();

  if (!account) {
    throw new TikTokApiError("TikTok account not found", "ACCOUNT_NOT_FOUND", false);
  }

  if (isAccessTokenFresh(account.access_token_expires_at, Date.now())) {
    return decryptFreshAccount(account);
  }

  // Access token is expiring — claim the per-account refresh lock atomically. Only the request
  // whose UPDATE matches a row (lock free or stale) performs the refresh-token rotation.
  const staleBefore = new Date(Date.now() - REFRESH_LOCK_STALE_MS).toISOString();
  const { data: claimed, error: claimError } = await svc
    .from("tiktok_accounts")
    .update({ refresh_lock_at: new Date().toISOString() })
    .eq("id", accountId)
    .or(`refresh_lock_at.is.null,refresh_lock_at.lt.${staleBefore}`)
    .select("id, encrypted_refresh_token, tiktok_open_id")
    .maybeSingle();

  // A claim-read failure (PostgREST/network error) is NOT the same thing as losing the lock
  // race — that case is `data: null` with no `error`, and must keep polling as before.
  if (claimError) {
    throw new TikTokApiError(
      `Failed to claim TikTok refresh lock: ${claimError.message}`,
      "REFRESH_FAILED",
      true,
    );
  }

  if (!claimed) {
    return pollForRefreshedToken(svc, accountId, sleep);
  }

  return refreshClaimedAccount(svc, accountId, claimed as TikTokAccountClaimRow);
}

/** Performs the refresh call for a claimed account and releases the lock on every exit path. */
async function refreshClaimedAccount(
  svc: SupabaseClient,
  accountId: string,
  claimed: TikTokAccountClaimRow,
): Promise<{ accessToken: string; openId: string }> {
  let lockHeld = true;
  try {
    if (!claimed.encrypted_refresh_token) {
      throw new TikTokApiError("TikTok account has no refresh token on file", "TOKEN_EXPIRED", false);
    }
    const refreshToken = await decryptTikTokToken(claimed.encrypted_refresh_token, "refresh");
    const { clientKey, clientSecret } = requireTikTokClientCredentials();

    const body = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const response = await fetch(`${TIKTOK_API_BASE}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const payload = (await response.json()) as TikTokRefreshSuccessBody | TikTokRefreshErrorBody;

    if ("error" in payload) {
      if (payload.error === "invalid_grant") {
        // Dead refresh token — flip the account to expired and release the lock in the SAME
        // update (a re-auth is now required; nothing left for the lock to protect).
        const { error: markError } = await svc
          .from("tiktok_accounts")
          .update({ authorization_status: "expired", refresh_lock_at: null })
          .eq("id", accountId);
        if (markError) {
          // The marker write failing must not mask the real condition (dead refresh token) —
          // log and still throw TOKEN_EXPIRED below.
          console.error(
            `Failed to mark TikTok account ${accountId} as expired: ${markError.message}`,
          );
        }
        lockHeld = false;
        throw new TikTokApiError(
          payload.error_description || "TikTok refresh token is no longer valid",
          "TOKEN_EXPIRED",
          false,
        );
      }
      throw new TikTokApiError(payload.error_description || payload.error, "REFRESH_FAILED", false);
    }

    const [encryptedAccess, encryptedRefresh] = await Promise.all([
      encryptTikTokToken(payload.access_token, "access"),
      encryptTikTokToken(payload.refresh_token, "refresh"),
    ]);
    const now = Date.now();

    // Persist the rotated token (and clear the lock) in ONE update, BEFORE returning.
    const { error: persistError } = await svc
      .from("tiktok_accounts")
      .update({
        encrypted_access_token: encryptedAccess,
        encrypted_refresh_token: encryptedRefresh,
        access_token_expires_at: new Date(now + payload.expires_in * 1000).toISOString(),
        refresh_token_expires_at: new Date(now + payload.refresh_expires_in * 1000).toISOString(),
        refresh_lock_at: null,
      })
      .eq("id", accountId);

    if (persistError) {
      // Persist failed — the rotated refresh token was NOT written. The access token must NOT
      // be returned (the next refresh would use the now-dead old refresh token and permanently
      // brick the account). lockHeld stays true so the finally below still releases the claim.
      throw new TikTokApiError(
        `Failed to persist refreshed TikTok tokens: ${persistError.message}`,
        "REFRESH_FAILED",
        true,
      );
    }
    lockHeld = false;

    return { accessToken: payload.access_token, openId: payload.open_id };
  } finally {
    if (lockHeld) {
      // Any other failure (network error, malformed response, missing env, non-invalid_grant
      // TikTok error) must still release the claim so the next caller can retry.
      const { error: releaseError } = await svc
        .from("tiktok_accounts")
        .update({ refresh_lock_at: null })
        .eq("id", accountId);
      if (releaseError) {
        // Do NOT throw from finally — that would mask the in-flight error being propagated;
        // the 60s stale window (REFRESH_LOCK_STALE_MS) is the documented backstop for exactly this.
        console.error(
          `Failed to release TikTok refresh lock for account ${accountId}: ${releaseError.message}`,
        );
      }
    }
  }
}

/** Lost the claim race — another process is (or just finished) refreshing. Poll instead of
 * racing it: up to 3 attempts, 2s apart, waiting for access_token_expires_at to move forward. */
async function pollForRefreshedToken(
  svc: SupabaseClient,
  accountId: string,
  sleep: (ms: number) => Promise<void>,
): Promise<{ accessToken: string; openId: string }> {
  for (let attempt = 0; attempt < REFRESH_LOCK_POLL_ATTEMPTS; attempt++) {
    await sleep(REFRESH_LOCK_POLL_INTERVAL_MS);
    const { data: account } = await svc
      .from("tiktok_accounts")
      .select("id, tiktok_open_id, encrypted_access_token, access_token_expires_at")
      .eq("id", accountId)
      .maybeSingle();
    if (account && isAccessTokenFresh(account.access_token_expires_at, Date.now())) {
      return decryptFreshAccount(account);
    }
  }
  throw new TikTokApiError(
    "Timed out waiting for a concurrent TikTok token refresh to complete",
    "REFRESH_LOCK_TIMEOUT",
    true,
  );
}
