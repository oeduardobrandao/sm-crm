// HMAC-signed OAuth state for the Google (YouTube + Google Meu Negócio) connect flow. Same
// signing scheme as tiktok-integration/oauth-state.ts (HMAC-SHA256 keyed from
// TOKEN_ENCRYPTION_KEY, base64url payload + "." + base64url signature, 10-minute TTL). The
// payload and the oauth_states row carry provider 'google', so a state minted by another
// provider (same key) is refused here. Unlike TikTok, verifyGoogleState also consumes the
// nonce, so a callback cannot forget to.

import type { GoogleProduct } from "../_shared/google.ts";

const STATE_TTL_MS = 10 * 60 * 1000;
const PROVIDER = "google";
const PRODUCTS: readonly GoogleProduct[] = ["youtube", "gbp"];

// deno-lint-ignore no-explicit-any
type DbClient = any;

export interface GoogleStateParams {
  clientId: string;
  userId: string;
  contaId: string;
  product: GoogleProduct;
  consentRetry: boolean;
}

export interface VerifiedGoogleState extends GoogleStateParams {
  nonce: string;
}

function getTokenEncryptionKey(): string {
  const key = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY required");
  return key;
}

function getHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getTokenEncryptionKey().slice(0, 32).padEnd(32, "0")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toUrlSafeBase64(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromUrlSafeBase64(b64: string): string {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  return pad ? padded + "=".repeat(4 - pad) : padded;
}

export async function createGoogleState(p: GoogleStateParams, svc: DbClient): Promise<string> {
  // Opportunistic cleanup of long-expired rows, as the other providers do.
  await svc.from("oauth_states").delete().lt("expires_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

  const nonce = crypto.randomUUID();
  const iat = Date.now();
  const payload = JSON.stringify({
    clientId: p.clientId,
    userId: p.userId,
    contaId: p.contaId,
    provider: PROVIDER,
    product: p.product,
    consentRetry: p.consentRetry,
    nonce,
    iat,
  });
  const sigBuf = await crypto.subtle.sign("HMAC", await getHmacKey(), new TextEncoder().encode(payload));
  const payloadB64 = toUrlSafeBase64(btoa(payload));
  const sigB64 = toUrlSafeBase64(btoa(String.fromCharCode(...new Uint8Array(sigBuf))));

  const { error } = await svc.from("oauth_states").insert({
    nonce,
    client_id: parseInt(p.clientId, 10),
    conta_id: p.contaId,
    initiated_by: p.userId,
    provider: PROVIDER,
    expires_at: new Date(iat + STATE_TTL_MS).toISOString(),
  });
  if (error) {
    // Without the row the callback could never consume the nonce: fail now, not at callback.
    console.error(`google-oauth-state: failed to insert oauth_states row: ${error.message}`);
    throw new Error("oauth_state_insert_failed");
  }

  return `${payloadB64}.${sigB64}`;
}

export async function verifyGoogleState(state: string, svc: DbClient): Promise<VerifiedGoogleState> {
  let s: string;
  try {
    s = decodeURIComponent(state);
  } catch {
    throw new Error("Invalid state format");
  }
  const dotIdx = s.indexOf(".");
  if (dotIdx === -1) throw new Error("Invalid state format");

  let payload: string;
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    payload = atob(fromUrlSafeBase64(s.slice(0, dotIdx)));
    sigBytes = Uint8Array.from(atob(fromUrlSafeBase64(s.slice(dotIdx + 1))), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("Invalid state format");
  }

  const valid = await crypto.subtle.verify("HMAC", await getHmacKey(), sigBytes, new TextEncoder().encode(payload));
  if (!valid) throw new Error("State signature invalid");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("Invalid state format");
  }
  if (typeof parsed.iat !== "number" || Date.now() - parsed.iat > STATE_TTL_MS) throw new Error("State expired");
  if (parsed.provider !== PROVIDER) throw new Error("Invalid state provider");
  if (!PRODUCTS.includes(parsed.product as GoogleProduct)) throw new Error("Invalid state product");
  if (
    typeof parsed.clientId !== "string" ||
    typeof parsed.userId !== "string" ||
    typeof parsed.contaId !== "string" ||
    typeof parsed.nonce !== "string" ||
    typeof parsed.consentRetry !== "boolean"
  ) {
    throw new Error("Invalid state format");
  }

  // Single-use: only the first verification flips consumed_at on a live, unconsumed row.
  const { data: consumed, error } = await svc
    .from("oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("nonce", parsed.nonce)
    .eq("provider", PROVIDER)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (error) {
    console.error(`google-oauth-state: nonce consume failed: ${error.message}`);
    throw new Error("state_check_failed");
  }
  if (!consumed) throw new Error("state_replayed");

  return {
    clientId: parsed.clientId,
    userId: parsed.userId,
    contaId: parsed.contaId,
    product: parsed.product as GoogleProduct,
    consentRetry: parsed.consentRetry,
    nonce: parsed.nonce,
  };
}
