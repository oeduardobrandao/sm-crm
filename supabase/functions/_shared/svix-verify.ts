/**
 * Svix webhook signature verification (https://docs.svix.com/receiving/verifying-payloads/how-manual).
 * Signed content is `${id}.${timestamp}.${body}`, key = base64-decoded part of the secret after
 * `whsec_`, HMAC-SHA256, header = space-separated `v1,<base64>` entries (any match accepts).
 */

function b64decode(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifySvixSignature(p: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): Promise<boolean> {
  if (!p.id || !p.timestamp || !p.signature) return false;
  if (!/^\d+$/.test(p.timestamp)) return false;
  const tolerance = p.toleranceSeconds ?? 300;
  if (Math.abs(p.nowSeconds - Number(p.timestamp)) > tolerance) return false;

  const keyBytes = b64decode(p.secret.startsWith("whsec_") ? p.secret.slice(6) : p.secret);
  if (!keyBytes || keyBytes.length === 0) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${p.id}.${p.timestamp}.${p.body}`),
    ),
  );

  let ok = false;
  for (const part of p.signature.split(" ")) {
    const comma = part.indexOf(",");
    if (comma < 0 || part.slice(0, comma) !== "v1") continue;
    const got = b64decode(part.slice(comma + 1));
    if (got && equalBytes(got, expected)) ok = true;
  }
  return ok;
}
