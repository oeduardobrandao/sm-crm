// supabase/functions/_shared/mcp-send-nonce.ts
//
// Send nonce of the MCP Apps cards (spec 2026-10-29-mcp-apps-cards-design.md §4.4): the only thing
// that lets `send_post_to_client` send. It rides in the result `_meta` of create_post, update_post
// and preview_post, which the host hands to the card, not to the model.
//
// Shape: base64url(JSON{conta_id, user_id, post_id, exp}) + "." + base64url(HMAC-SHA256 over the
// payload base64url STRING), both without padding; `exp` is milliseconds since epoch. The HMAC key
// is derived with HKDF-SHA256 (empty salt) from TOKEN_ENCRYPTION_KEY with its own info string
// ('mcp-send-nonce'), so it is independent of every other key derived from that secret.
//
// verifySendNonce never throws: any malformed, tampered, mismatched or expired nonce is `false`.
import { timingSafeEqual } from "./crypto.ts";

export const SEND_NONCE_TTL_MS = 30 * 60 * 1000;

export type SendNonceFields = { conta_id: string; user_id: string; post_id: number };

const enc = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("mcp-send-nonce") },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeText(str: string): string {
  const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function mac(secret: string, payloadB64: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payloadB64));
  return base64UrlEncode(new Uint8Array(sig));
}

export async function signSendNonce(secret: string, p: SendNonceFields, now = Date.now()): Promise<string> {
  const payload = { conta_id: p.conta_id, user_id: p.user_id, post_id: p.post_id, exp: now + SEND_NONCE_TTL_MS };
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  return `${payloadB64}.${await mac(secret, payloadB64)}`;
}

export async function verifySendNonce(
  secret: string,
  nonce: string,
  expect: SendNonceFields,
  now = Date.now(),
): Promise<boolean> {
  try {
    if (typeof nonce !== "string") return false;
    const parts = nonce.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    const [payloadB64, given] = parts;
    // MAC first: nothing in an unauthenticated payload is trusted, not even for parsing.
    if (!timingSafeEqual(await mac(secret, payloadB64), given)) return false;
    const payload = JSON.parse(base64UrlDecodeText(payloadB64));
    if (!payload || typeof payload !== "object") return false;
    const { conta_id, user_id, post_id, exp } = payload as Record<string, unknown>;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return false;
    if (conta_id !== expect.conta_id || user_id !== expect.user_id || post_id !== expect.post_id) return false;
    return now <= exp;
  } catch {
    return false;
  }
}
