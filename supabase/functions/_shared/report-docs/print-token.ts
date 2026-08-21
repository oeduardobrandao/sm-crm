// Print token HMAC do export de PDF (spec §9): payload {docId, exp} assinado
// com INTERNAL_FUNCTION_SECRET, sem estado no banco. Independente do token de
// portal do Hub: relatórios são entitlement próprio (feature_analytics_reports).
const enc = new TextEncoder();

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
  return crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages,
  );
}

export async function signPrintToken(
  docId: string, expEpochS: number, secret: string,
): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ docId, exp: expEpochS })));
  const key = await hmacKey(secret, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyPrintToken(
  token: string, docId: string, nowEpochS: number, secret: string,
): Promise<boolean> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
  const payloadB64 = token.slice(0, dot);
  const sigBytes = b64urlDecode(token.slice(dot + 1));
  if (!sigBytes || sigBytes.length === 0) return false;
  const key = await hmacKey(secret, ["verify"]);
  // crypto.subtle.verify é comparação em tempo constante.
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payloadB64));
  if (!ok) return false;
  const payloadBytes = b64urlDecode(payloadB64);
  if (!payloadBytes) return false;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      docId?: unknown; exp?: unknown;
    };
    return parsed.docId === docId && typeof parsed.exp === "number" && parsed.exp > nowEpochS;
  } catch {
    return false;
  }
}
