/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses XOR accumulator so execution time is independent of where strings differ.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);

  if (aBuf.length !== bBuf.length) {
    // Compare against self to burn the same amount of time,
    // then return false.
    let _ = 0;
    for (let i = 0; i < aBuf.length; i++) {
      _ |= aBuf[i] ^ aBuf[i];
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < aBuf.length; i++) {
    result |= aBuf[i] ^ bBuf[i];
  }
  return result === 0;
}

async function deriveEncryptionKey(secret: string, purpose: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HKDF" },
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(purpose) },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

export async function encryptText(plainText: string, secret: string, purpose: string): Promise<string> {
  const key = await deriveEncryptionKey(secret, purpose, ["encrypt"]);
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plainText));
  const encryptedBytes = new Uint8Array(encrypted);
  const combined = new Uint8Array(iv.length + encryptedBytes.length);
  combined.set(iv);
  combined.set(encryptedBytes, iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptText(cipherText: string, secret: string, purpose: string): Promise<string> {
  const combined = Uint8Array.from(atob(cipherText), (char) => char.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const payload = combined.slice(12);
  const key = await deriveEncryptionKey(secret, purpose, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, payload);
  return new TextDecoder().decode(decrypted);
}
