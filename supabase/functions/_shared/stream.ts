// Shared Cloudflare Stream client: gating, video copy-in, signed HLS playback
// URLs, webhook signature verification, and lifecycle (status/delete/list).
//
// Unlike most _shared modules, env vars are read INSIDE each function rather
// than at module load. That means absence disables the feature (checked via
// isStreamCleanupEnabled/isStreamEnabled) instead of throwing at import time,
// and tests can Deno.env.set/delete freely between cases without reimporting.
//
// Every fetch to the Stream API is bounded by AbortSignal.timeout — the edge
// runtime kills isolates on unbounded I/O in ways that bypass the surrounding
// catch entirely (see AGENTS.md "Edge runtime kills bypass catch"; this repo
// had a 100%-hang incident with the R2 SDK for exactly this reason), so a
// hang here must surface as a normal retryable throw instead. One value for
// all four calls: copy initiation can be slower than a status GET, but 15s is
// still well under the isolate's own wall-clock budget.
const STREAM_FETCH_TIMEOUT_MS = 15_000;

function streamBase(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`;
}

function authHeaders(): Record<string, string> {
  return { "Authorization": `Bearer ${Deno.env.get("STREAM_API_TOKEN") ?? ""}` };
}

/** True once the vars needed to delete/orphan-sweep Stream videos are set. */
export function isStreamCleanupEnabled(): boolean {
  return Boolean(Deno.env.get("STREAM_ACCOUNT_ID") && Deno.env.get("STREAM_API_TOKEN"));
}

/** True once every var needed for the full copy + signed-playback + webhook flow is set. */
export function isStreamEnabled(): boolean {
  return (
    isStreamCleanupEnabled() &&
    Boolean(
      Deno.env.get("STREAM_CUSTOMER_CODE") &&
        Deno.env.get("STREAM_SIGNING_KEY_ID") &&
        Deno.env.get("STREAM_SIGNING_KEY_JWK") &&
        Deno.env.get("STREAM_WEBHOOK_SECRET"),
    )
  );
}

/**
 * Kicks off a Cloudflare Stream "copy from URL" ingest and returns the new
 * video's uid. Always requests signed playback (requireSignedURLs: true) so
 * the video is never reachable without a signPlaybackUrl() token.
 */
export async function copyToStream(
  sourceUrl: string,
  meta: Record<string, string>,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const accountId = Deno.env.get("STREAM_ACCOUNT_ID") ?? "";
  const res = await fetchFn(`${streamBase(accountId)}/copy`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ url: sourceUrl, meta, requireSignedURLs: true }),
    signal: AbortSignal.timeout(STREAM_FETCH_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => null) as
    | { success?: boolean; result?: { uid?: string } }
    | null;
  const uid = json?.result?.uid;
  if (!res.ok || json?.success === false || !uid) {
    // Message stays internal (status code only) — callers log it, never forward to a client.
    throw new Error("stream copy failed: " + res.status);
  }
  return uid;
}

function toBase64Url(input: string | Uint8Array): string {
  const binary = typeof input === "string" ? input : String.fromCharCode(...input);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Signs a short-lived Cloudflare Stream playback JWT and returns the HLS
 * manifest URL that embeds it, plus the token's expiry as an ISO string.
 * Default expiry is 12 hours (43_200s), matching a typical review/approval window.
 */
export async function signPlaybackUrl(
  uid: string,
  expSeconds = 43_200,
): Promise<{ hls: string; expires_at: string }> {
  const customerCode = Deno.env.get("STREAM_CUSTOMER_CODE") ?? "";
  const kid = Deno.env.get("STREAM_SIGNING_KEY_ID") ?? "";
  const jwk = JSON.parse(atob(Deno.env.get("STREAM_SIGNING_KEY_JWK") ?? ""));
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const exp = Math.floor(Date.now() / 1000) + expSeconds;
  const headerB64 = toBase64Url(JSON.stringify({ alg: "RS256", kid }));
  const payloadB64 = toBase64Url(JSON.stringify({ sub: uid, kid, exp }));
  const signingInput = `${headerB64}.${payloadB64}`;

  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const token = `${signingInput}.${toBase64Url(new Uint8Array(sigBuf))}`;

  return {
    hls: `https://customer-${customerCode}.cloudflarestream.com/${token}/manifest/video.m3u8`,
    expires_at: new Date(exp * 1000).toISOString(),
  };
}

async function hmacHex(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verifies a Cloudflare Stream webhook delivery. Header shape is
 * `time=<unix seconds>,sig1=<hex hmac>` where sig1 = HMAC-SHA256(secret, `${time}.${body}`).
 * Rejects a missing/malformed header, a timestamp more than 5 minutes off "now",
 * or a signature mismatch — comparison is timing-safe.
 */
export async function verifyStreamWebhookSignature(
  body: string,
  sigHeader: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const secret = Deno.env.get("STREAM_WEBHOOK_SECRET") ?? "";
  if (!secret || !sigHeader) return false;

  const parts: Record<string, string> = {};
  for (const kv of sigHeader.split(",")) {
    const eq = kv.indexOf("=");
    if (eq === -1) continue;
    parts[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
  }
  const time = parts["time"];
  const sig1 = parts["sig1"];
  if (!time || !sig1 || !/^\d+$/.test(time)) return false;
  if (Math.abs(nowSeconds - Number(time)) > 300) return false;

  const expected = await hmacHex(secret, `${time}.${body}`);
  return timingSafeEqualHex(expected, sig1);
}

/** Deletes a Stream video. A 404 (already gone) counts as success. */
export async function deleteStreamVideo(uid: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const accountId = Deno.env.get("STREAM_ACCOUNT_ID") ?? "";
  const res = await fetchFn(`${streamBase(accountId)}/${uid}`, {
    method: "DELETE",
    headers: authHeaders(),
    signal: AbortSignal.timeout(STREAM_FETCH_TIMEOUT_MS),
  });
  if (res.status === 200 || res.status === 404) return;
  throw new Error("stream delete failed: " + res.status);
}

/** Fetches a video's processing status, collapsing every non-terminal state to "inprogress". */
export async function getStreamVideoStatus(
  uid: string,
  fetchFn: typeof fetch = fetch,
): Promise<"ready" | "error" | "inprogress"> {
  const accountId = Deno.env.get("STREAM_ACCOUNT_ID") ?? "";
  const res = await fetchFn(`${streamBase(accountId)}/${uid}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(STREAM_FETCH_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => null) as
    | { result?: { status?: { state?: string } } }
    | null;
  const state = json?.result?.status?.state;
  return state === "ready" || state === "error" ? state : "inprogress";
}

/** Lists every video in the account, paginating the `after` cursor until a short page ends it. */
export async function listStreamVideos(
  fetchFn: typeof fetch = fetch,
): Promise<Array<{ uid: string; created: string }>> {
  const accountId = Deno.env.get("STREAM_ACCOUNT_ID") ?? "";
  const base = streamBase(accountId);
  const headers = authHeaders();

  const items: Array<{ uid: string; created: string }> = [];
  let after: string | undefined;
  for (;;) {
    const url = after
      ? `${base}?asc=true&after=${encodeURIComponent(after)}`
      : `${base}?asc=true`;
    const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(STREAM_FETCH_TIMEOUT_MS) });
    const json = await res.json().catch(() => null) as
      | { success?: boolean; result?: Array<{ uid: string; created: string }> }
      | null;
    // A Cloudflare error response (401/429/5xx, or a 200 with success:false) must never be
    // read as "no more videos" -- that would let the orphan reap silently no-op against a
    // partial or empty list, hiding the outage instead of skipping cleanup for the run.
    // Throw so the caller's existing per-step catch counts it into `errors` (the purge
    // script's own listAllVideos() is a separate copy and untouched by this check).
    if (!res.ok || json?.success === false) {
      throw new Error("stream list failed: " + res.status);
    }
    const page = json?.result ?? [];
    for (const v of page) items.push({ uid: v.uid, created: v.created });
    if (page.length < 1000) break;
    const last = page[page.length - 1]?.created;
    if (!last) break;
    after = last;
  }
  return items;
}
