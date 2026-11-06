// Unsubscribe token for the nurture emails (never-paid owners). Same approach
// as the client-event-email token (b64url + HMAC-SHA256, constant-time verify
// via crypto.subtle.verify, no exp: an old email must always be able to opt
// out) but a separate module and key: payload is `{u: <profile uuid>}`, and
// the client verifier only accepts integer ids.

const enc = new TextEncoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array | null {
  try {
    const norm = s.replace(/-/g, "+").replace(/_/g, "/");
    const padded = norm.padEnd(norm.length + ((4 - (norm.length % 4)) % 4), "=");
    const bin = atob(padded);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

export async function signNurtureUnsubToken(userId: string, secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ u: userId })));
  const key = await hmacKey(secret, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

/** The user id, or `null` on a bad signature, malformed token or non-uuid payload. */
export async function verifyNurtureUnsubToken(token: string, secret: string): Promise<string | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sigBytes = b64urlDecode(token.slice(dot + 1));
  if (!sigBytes || sigBytes.length === 0) return null;
  const key = await hmacKey(secret, ["verify"]);
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes as BufferSource, enc.encode(payloadB64));
  if (!ok) return null;
  const payloadBytes = b64urlDecode(payloadB64);
  if (!payloadBytes) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as { u?: unknown } | null;
    if (!parsed || typeof parsed !== "object") return null;
    return typeof parsed.u === "string" && UUID_RE.test(parsed.u) ? parsed.u : null;
  } catch {
    return null;
  }
}

export function nurtureUnsubUrl(supabaseUrl: string, token: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/nurture-unsub/${token}`;
}

/**
 * Confirmation page in the CRM (`/descadastrar/:token`), linked from the email
 * footer. The Supabase gateway rewrites function HTML to text/plain with a
 * sandbox CSP, so the function's own page shows as raw markup; this page POSTs
 * the token to the function instead.
 */
export function nurtureUnsubPageUrl(appBaseUrl: string, token: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/descadastrar/${token}`;
}
