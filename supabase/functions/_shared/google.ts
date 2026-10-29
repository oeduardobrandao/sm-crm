// Shared Google (YouTube + Google Meu Negócio) OAuth, token crypto, the authenticated API fetch
// wrapper and the lock-serialized token freshness path. Every Google edge function imports from
// here; no copy-paste of wire strings, token crypto or error mapping anywhere else.
// Spec: docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md §4.2.
//
// Error contract: every failure this module raises is a GoogleApiError with one of eight codes,
// so callers switch on `code` only.
//   googleFetch: 401 -> TOKEN_INVALID; 403/429 carrying quota_limit_value "0" -> NOT_APPROVED;
//     other 429 -> RATE_LIMITED (retryable); 403 SERVICE_DISABLED / "has not been used in
//     project" / "API has not been enabled" -> API_DISABLED; other 403 -> FORBIDDEN;
//     404 -> NOT_FOUND; 5xx -> UPSTREAM (retryable); any other non-2xx -> UPSTREAM
//     (non-retryable, status kept).
//   exchangeGoogleCode / fetchGoogleUserInfo malformed or failed response -> UPSTREAM.
//   getFreshGoogleToken: row missing -> NOT_FOUND; connection already revoked or refresh hits
//     invalid_grant -> REVOKED; no refresh token on file -> TOKEN_INVALID (re-auth needed, the
//     connection is NOT marked revoked); claim/persist failure or poll timeout -> UPSTREAM
//     (retryable); other token-endpoint error -> UPSTREAM (retryable only for 5xx/network).

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decryptText, encryptText } from "./crypto.ts";

/** Same client type `_shared/tiktok.ts` uses; tests pass the shared supabaseMock cast `as never`. */
export type DbClient = SupabaseClient;

// --- Wire constants ---

export type GoogleProduct = "youtube" | "gbp";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_PRODUCT_SCOPES: Record<GoogleProduct, string[]> = {
  youtube: [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ],
  gbp: ["https://www.googleapis.com/auth/business.manage"],
};

export const GOOGLE_BASE_SCOPES = ["openid", "email", "profile"];

const DEFAULT_TIMEOUT_MS = 10_000;
const TOKEN_ENDPOINT_TIMEOUT_MS = 20_000;

// --- Errors ---

export type GoogleApiErrorCode =
  | "TOKEN_INVALID"
  | "REVOKED"
  | "RATE_LIMITED"
  | "NOT_APPROVED"
  | "API_DISABLED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "UPSTREAM";

export class GoogleApiError extends Error {
  code: GoogleApiErrorCode;
  status: number;
  retryable: boolean;

  constructor(code: GoogleApiErrorCode, status: number, message?: string, retryable?: boolean) {
    super(message ?? `Google API error ${code} (status ${status})`);
    this.name = "GoogleApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable ?? (code === "RATE_LIMITED" || code === "UPSTREAM");
  }
}

// --- Credentials / redirect ---

export function requireGoogleClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET environment variables are required");
  }
  return { clientId, clientSecret };
}

/** The exact same string is sent in the auth request and in the code exchange. */
export function googleRedirectUri(): string {
  const explicit = Deno.env.get("GOOGLE_REDIRECT_URI");
  if (explicit) return explicit;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL environment variable is required to build the Google redirect URI");
  }
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/google-integration/callback`;
}

// --- OAuth ---

export function buildGoogleAuthUrl(opts: { product: GoogleProduct; state: string; consent: boolean }): string {
  const { clientId } = requireGoogleClientCredentials();
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", [...GOOGLE_PRODUCT_SCOPES[opts.product], ...GOOGLE_BASE_SCOPES].join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", opts.consent ? "consent" : "select_account");
  url.searchParams.set("state", opts.state);
  return url.toString();
}

interface GoogleTokenSuccessBody {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

interface GoogleTokenErrorBody {
  error: string;
  error_description?: string;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function exchangeGoogleCode(
  code: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date; scopes: string[] }> {
  const { clientId, clientSecret } = requireGoogleClientCredentials();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(TOKEN_ENDPOINT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new GoogleApiError("UPSTREAM", 0, `Google code exchange request failed: ${(err as Error).message}`);
  }

  const payload = (await readJson(response)) as Partial<GoogleTokenSuccessBody> & Partial<GoogleTokenErrorBody> | null;
  if (!response.ok || !payload || payload.error || typeof payload.access_token !== "string") {
    const reason = payload?.error ?? "malformed_response";
    throw new GoogleApiError(
      "UPSTREAM",
      response.status,
      `Google code exchange failed: ${reason}`,
      response.status >= 500,
    );
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: new Date(Date.now() + Number(payload.expires_in ?? 0) * 1000),
    scopes: (payload.scope ?? "").split(" ").filter(Boolean),
  };
}

export async function fetchGoogleUserInfo(
  accessToken: string,
): Promise<{ sub: string; email: string; name: string | null }> {
  const info = (await googleFetch(GOOGLE_USERINFO_URL, accessToken)) as
    | { sub?: unknown; email?: unknown; name?: unknown }
    | null;
  if (!info || typeof info.sub !== "string" || !info.sub || typeof info.email !== "string" || !info.email) {
    throw new GoogleApiError("UPSTREAM", 200, "Google userinfo response is missing sub or email", false);
  }
  return { sub: info.sub, email: info.email, name: typeof info.name === "string" && info.name ? info.name : null };
}

/** Checks the product scopes only: Google echoes the base scopes back as userinfo.* URLs. */
export function hasRequiredScopes(product: GoogleProduct, granted: string[]): boolean {
  const set = new Set(granted);
  return GOOGLE_PRODUCT_SCOPES[product].every((s) => set.has(s));
}

/** Never throws: `google_revocations.attempts` is the retry loop. 400 invalid_token = already gone. */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (response.ok) return true;
    if (response.status === 400) {
      const payload = (await readJson(response)) as { error?: string } | null;
      return payload?.error === "invalid_token";
    }
    return false;
  } catch (err) {
    console.error(`google: token revoke request failed: ${(err as Error).message}`);
    return false;
  }
}

// --- Token crypto (encryptText/decryptText, HKDF purpose per token kind) ---

function requireEncryptionSecret(): string {
  const secret = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!secret) {
    throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required");
  }
  return secret;
}

function tokenPurpose(kind: "access" | "refresh"): string {
  return kind === "access" ? "google-access-token" : "google-refresh-token";
}

export function encryptGoogleToken(plain: string, kind: "access" | "refresh"): Promise<string> {
  return Promise.resolve().then(() => encryptText(plain, requireEncryptionSecret(), tokenPurpose(kind)));
}

export function decryptGoogleToken(enc: string, kind: "access" | "refresh"): Promise<string> {
  return Promise.resolve().then(() => decryptText(enc, requireEncryptionSecret(), tokenPurpose(kind)));
}

// --- API fetch wrapper ---

interface GoogleErrorDetail {
  "@type"?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string; message?: string }>;
    details?: GoogleErrorDetail[];
  };
}

function isQuotaZero(body: GoogleErrorBody | null): boolean {
  const details = body?.error?.details;
  if (!Array.isArray(details)) return false;
  return details.some((d) => {
    const v = d?.metadata?.quota_limit_value;
    return v === "0" || v === 0;
  });
}

function isServiceDisabled(body: GoogleErrorBody | null): boolean {
  const err = body?.error;
  if (!err) return false;
  if (Array.isArray(err.details) && err.details.some((d) => d?.reason === "SERVICE_DISABLED")) return true;
  if (Array.isArray(err.errors) && err.errors.some((e) => e?.reason === "SERVICE_DISABLED")) return true;
  const message = err.message ?? "";
  return message.includes("has not been used in project") || message.includes("API has not been enabled");
}

function mapGoogleError(status: number, body: GoogleErrorBody | null): GoogleApiError {
  const message = body?.error?.message ?? `Google API responded ${status}`;
  if (status === 401) return new GoogleApiError("TOKEN_INVALID", status, message);
  if ((status === 403 || status === 429) && isQuotaZero(body)) {
    return new GoogleApiError("NOT_APPROVED", status, message);
  }
  if (status === 429) return new GoogleApiError("RATE_LIMITED", status, message);
  if (status === 403) {
    if (isServiceDisabled(body)) return new GoogleApiError("API_DISABLED", status, message);
    return new GoogleApiError("FORBIDDEN", status, message);
  }
  if (status === 404) return new GoogleApiError("NOT_FOUND", status, message);
  if (status >= 500) return new GoogleApiError("UPSTREAM", status, message);
  return new GoogleApiError("UPSTREAM", status, message, false);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

/**
 * Authenticated JSON fetch against a Google API. Returns the parsed body (null for an empty
 * body) and throws a GoogleApiError mapped per the module header. Always carries a timeout
 * signal (10 s default), combined with any caller-supplied signal.
 */
export async function googleFetch(
  url: string,
  accessToken: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<unknown> {
  const { timeoutMs, headers, signal, ...rest } = init;
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Authorization", `Bearer ${accessToken}`);
  if (!requestHeaders.has("Content-Type") && rest.body && typeof rest.body === "string") {
    requestHeaders.set("Content-Type", "application/json; charset=UTF-8");
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url, { ...rest, headers: requestHeaders, signal: combinedSignal });
  } catch (err) {
    throw new GoogleApiError("UPSTREAM", 0, `Google API request failed: ${(err as Error).message}`);
  }

  const body = await readJson(response);
  if (!response.ok) {
    const error = mapGoogleError(response.status, body as GoogleErrorBody | null);
    if (error.code === "API_DISABLED") {
      // A config error on our side (API not enabled in the Cloud project), not a user problem.
      console.error(`google:api-disabled host=${hostOf(url)} status=${response.status}: ${error.message}`);
    }
    throw error;
  }
  return body;
}

// --- Lock-serialized token freshness ---
//
// Same algorithm as getFreshTikTokToken (_shared/tiktok.ts): an atomic claim UPDATE on
// `refresh_lock_at` (60 s stale window) serializes refreshes per connection; losing the claim
// polls the row instead of refreshing again; every lock write-back is guarded on the exact
// claim timestamp; the lock is released in a `finally` on every path. Google refresh tokens
// usually do not rotate, so a refresh response without `refresh_token` keeps the stored one.

/** Access token is refreshed once fewer than this many ms remain before expiry. */
const ACCESS_TOKEN_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;
/** A refresh claim older than this is treated as abandoned and re-claimable. */
const REFRESH_LOCK_STALE_MS = 60 * 1000;
const REFRESH_LOCK_POLL_ATTEMPTS = 3;
const REFRESH_LOCK_POLL_INTERVAL_MS = 2000;

const FRESHNESS_SELECT = "id, status, encrypted_access_token, access_token_expires_at";

interface GoogleConnectionFreshnessRow {
  id: string;
  status: string;
  encrypted_access_token: string | null;
  access_token_expires_at: string | null;
}

interface GoogleConnectionClaimRow {
  id: string;
  encrypted_refresh_token: string | null;
  refresh_lock_at?: string | null;
}

function isAccessTokenFresh(expiresAt: string | null, now: number): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - now > ACCESS_TOKEN_FRESHNESS_WINDOW_MS;
}

function assertNotRevoked(row: GoogleConnectionFreshnessRow): void {
  if (row.status === "revoked") {
    throw new GoogleApiError("REVOKED", 401, "Google connection is revoked", false);
  }
}

async function decryptFreshRow(row: GoogleConnectionFreshnessRow): Promise<string> {
  if (!row.encrypted_access_token) {
    throw new GoogleApiError("TOKEN_INVALID", 401, "Google connection has no access token on file", false);
  }
  return decryptGoogleToken(row.encrypted_access_token, "access");
}

export interface GetFreshGoogleTokenOptions {
  /** Injected sleep for lock-contention polling; defaults to a real setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/** The ONLY code path that reads or refreshes Google tokens. Returns a live access token. */
export async function getFreshGoogleToken(
  svc: DbClient,
  connectionId: string,
  opts: GetFreshGoogleTokenOptions = {},
): Promise<string> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const { data: row } = await svc
    .from("google_connections")
    .select(FRESHNESS_SELECT)
    .eq("id", connectionId)
    .maybeSingle();

  if (!row) {
    throw new GoogleApiError("NOT_FOUND", 404, "Google connection not found", false);
  }
  const connection = row as GoogleConnectionFreshnessRow;
  assertNotRevoked(connection);

  if (isAccessTokenFresh(connection.access_token_expires_at, Date.now())) {
    return decryptFreshRow(connection);
  }

  const staleBefore = new Date(Date.now() - REFRESH_LOCK_STALE_MS).toISOString();
  const lockClaimedAt = new Date().toISOString();
  // `refresh_lock_at` MUST stay in the projection below: prod's PostgREST resolves columns
  // named inside an or-filter of an UPDATE against the ?select= projection, and raises
  // `42703 column ... refresh_lock_at does not exist` when it is absent (seen on
  // tiktok_accounts against prod 2026-08-20; staging's PostgREST version does not do this).
  const { data: claimed, error: claimError } = await svc
    .from("google_connections")
    .update({ refresh_lock_at: lockClaimedAt })
    .eq("id", connectionId)
    .or(`refresh_lock_at.is.null,refresh_lock_at.lt.${staleBefore}`)
    .select("id, encrypted_refresh_token, refresh_lock_at")
    .maybeSingle();

  // A claim-read failure is NOT losing the race (that is `data: null` with no error).
  if (claimError) {
    throw new GoogleApiError("UPSTREAM", 500, `Failed to claim Google refresh lock: ${claimError.message}`, true);
  }

  if (!claimed) {
    return pollForRefreshedToken(svc, connectionId, sleep);
  }

  return refreshClaimedConnection(svc, connectionId, claimed as GoogleConnectionClaimRow, lockClaimedAt);
}

async function refreshClaimedConnection(
  svc: DbClient,
  connectionId: string,
  claimed: GoogleConnectionClaimRow,
  lockClaimedAt: string,
): Promise<string> {
  let lockHeld = true;
  try {
    if (!claimed.encrypted_refresh_token) {
      throw new GoogleApiError("TOKEN_INVALID", 401, "Google connection has no refresh token on file", false);
    }
    const refreshToken = await decryptGoogleToken(claimed.encrypted_refresh_token, "refresh");
    const { clientId, clientSecret } = requireGoogleClientCredentials();

    let response: Response;
    try {
      response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(TOKEN_ENDPOINT_TIMEOUT_MS),
      });
    } catch (err) {
      throw new GoogleApiError("UPSTREAM", 0, `Google token refresh request failed: ${(err as Error).message}`, true);
    }

    const payload = (await readJson(response)) as Partial<GoogleTokenSuccessBody> & Partial<GoogleTokenErrorBody> | null;

    if (payload?.error === "invalid_grant") {
      // Dead grant (user revoked at Google, password change, 6-month idle). The RPC flips the
      // connection and its linked units to revoked; it does not touch refresh_lock_at, so the
      // ownership-guarded release in the finally still runs.
      const { error: markError } = await svc.rpc("google_mark_revoked", { p_connection_id: connectionId });
      if (markError) {
        console.error(`google: failed to mark connection ${connectionId} revoked: ${markError.message}`);
      }
      throw new GoogleApiError("REVOKED", response.status, "Google refresh token is no longer valid", false);
    }

    if (!response.ok || !payload || payload.error || typeof payload.access_token !== "string") {
      throw new GoogleApiError(
        "UPSTREAM",
        response.status,
        `Google token refresh failed: ${payload?.error ?? "malformed_response"}`,
        response.status >= 500,
      );
    }

    const accessToken = payload.access_token;
    const update: Record<string, unknown> = {
      encrypted_access_token: await encryptGoogleToken(accessToken, "access"),
      access_token_expires_at: new Date(Date.now() + Number(payload.expires_in ?? 0) * 1000).toISOString(),
      refresh_lock_at: null,
    };
    // Google usually omits refresh_token on refresh: omit the key so the stored one is kept.
    if (payload.refresh_token) {
      update.encrypted_refresh_token = await encryptGoogleToken(payload.refresh_token, "refresh");
    }

    // Persist (and clear the lock) in ONE update, BEFORE returning. Deliberately not
    // ownership-guarded: a rotated refresh token must be written even if the claim went stale.
    const { error: persistError } = await svc.from("google_connections").update(update).eq("id", connectionId);
    if (persistError) {
      throw new GoogleApiError(
        "UPSTREAM",
        500,
        `Failed to persist refreshed Google tokens: ${persistError.message}`,
        true,
      );
    }
    lockHeld = false;
    return accessToken;
  } finally {
    if (lockHeld) {
      const { error: releaseError } = await svc
        .from("google_connections")
        .update({ refresh_lock_at: null })
        .eq("id", connectionId)
        .eq("refresh_lock_at", lockClaimedAt);
      if (releaseError) {
        // Never throw from finally (it would mask the in-flight error); the stale window is the backstop.
        console.error(`google: failed to release refresh lock for ${connectionId}: ${releaseError.message}`);
      }
    }
  }
}

async function pollForRefreshedToken(
  svc: DbClient,
  connectionId: string,
  sleep: (ms: number) => Promise<void>,
): Promise<string> {
  for (let attempt = 0; attempt < REFRESH_LOCK_POLL_ATTEMPTS; attempt++) {
    await sleep(REFRESH_LOCK_POLL_INTERVAL_MS);
    const { data: row } = await svc
      .from("google_connections")
      .select(FRESHNESS_SELECT)
      .eq("id", connectionId)
      .maybeSingle();
    if (!row) {
      throw new GoogleApiError("NOT_FOUND", 404, "Google connection not found", false);
    }
    const connection = row as GoogleConnectionFreshnessRow;
    // The peer may have hit invalid_grant: stop polling at once.
    assertNotRevoked(connection);
    if (isAccessTokenFresh(connection.access_token_expires_at, Date.now())) {
      return decryptFreshRow(connection);
    }
  }
  throw new GoogleApiError(
    "UPSTREAM",
    503,
    "Timed out waiting for a concurrent Google token refresh to complete",
    true,
  );
}
