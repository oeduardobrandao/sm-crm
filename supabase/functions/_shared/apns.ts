/**
 * Apple Push Notification service client (token-based auth, HTTP/2).
 *
 * APNs only speaks HTTP/2; Deno's fetch negotiates it over ALPN (verified
 * 2026-10-10: an unauthenticated POST to api.sandbox.push.apple.com returns
 * APNs' own 403 {"reason":"MissingProviderToken"}).
 *
 * Auth is a short-lived ES256 JWT signed with the team's `.p8` key. Apple
 * rejects tokens older than an hour and throttles providers that mint a new one
 * more often than every 20 minutes, so one is cached for 50 minutes per client.
 */

export type ApnsEnvironment = "sandbox" | "production";

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** Contents of the AuthKey_XXXX.p8 file (PKCS#8 PEM). */
  privateKeyPem: string;
  /** The app's bundle ID, sent as apns-topic. */
  bundleId: string;
}

export interface ApnsAlert {
  title: string;
  subtitle?: string;
  body?: string;
}

export interface ApnsMessage {
  alert: ApnsAlert;
  badge?: number;
  /** Groups notifications in Notification Center. */
  threadId?: string;
  /** App-defined keys delivered next to `aps` (e.g. the CRM link to open). */
  data?: Record<string, string | number | null>;
}

export type ApnsResult =
  | { ok: true }
  | {
    ok: false;
    status: number;
    reason: string;
    /** The token will never work again: disable the device. */
    unregistered: boolean;
  };

export interface ApnsClient {
  send(token: string, environment: ApnsEnvironment, message: ApnsMessage): Promise<ApnsResult>;
}

interface ApnsDeps {
  fetch?: typeof fetch;
  nowMs?: () => number;
}

const HOSTS: Record<ApnsEnvironment, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

const TOKEN_TTL_MS = 50 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Pushes older than this are dropped by APNs instead of delivered late. */
const EXPIRATION_S = 60 * 60;

/** Reasons that mean the token is dead for this app (Apple's docs, "Handling
 * notification responses from APNs"). 410 is always terminal. */
const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);

function base64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ES256 JWT for APNs. WebCrypto's ECDSA signature is already the raw r||s
 * (IEEE P1363) form JWS expects, so no DER conversion is needed. */
export async function signApnsJwt(config: ApnsConfig, issuedAtS: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(config.privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64url(JSON.stringify({ iss: config.teamId, iat: issuedAtS }));
  const input = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  return `${input}.${base64url(new Uint8Array(sig))}`;
}

export function buildApnsPayload(message: ApnsMessage): Record<string, unknown> {
  const alert: Record<string, string> = { title: message.alert.title };
  if (message.alert.subtitle) alert.subtitle = message.alert.subtitle;
  if (message.alert.body) alert.body = message.alert.body;
  const aps: Record<string, unknown> = { alert, sound: "default" };
  if (typeof message.badge === "number") aps.badge = message.badge;
  if (message.threadId) aps["thread-id"] = message.threadId;
  return { aps, ...(message.data ?? {}) };
}

export function createApnsClient(config: ApnsConfig, deps: ApnsDeps = {}): ApnsClient {
  const doFetch = deps.fetch ?? fetch;
  const nowMs = deps.nowMs ?? Date.now;
  let cached: { jwt: string; mintedAt: number } | null = null;

  async function bearer(): Promise<string> {
    const now = nowMs();
    if (!cached || now - cached.mintedAt > TOKEN_TTL_MS) {
      cached = { jwt: await signApnsJwt(config, Math.floor(now / 1000)), mintedAt: now };
    }
    return cached.jwt;
  }

  return {
    async send(token, environment, message) {
      const res = await doFetch(`${HOSTS[environment]}/3/device/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${await bearer()}`,
          "apns-topic": config.bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": String(Math.floor(nowMs() / 1000) + EXPIRATION_S),
          "content-type": "application/json",
        },
        body: JSON.stringify(buildApnsPayload(message)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 200) {
        await res.body?.cancel();
        return { ok: true };
      }
      let reason = "Unknown";
      try {
        const body = await res.json() as { reason?: unknown };
        if (typeof body.reason === "string") reason = body.reason;
      } catch { /* non-JSON error body */ }
      // A stale or rejected provider token is ours to fix, not the device's:
      // drop the cache so the next send mints a fresh one.
      if (res.status === 403) cached = null;
      return {
        ok: false,
        status: res.status,
        reason,
        unregistered: res.status === 410 || DEAD_TOKEN_REASONS.has(reason),
      };
    },
  };
}
