/** Six decimal digits, the only shape `verify_code` forwards to the RPC. */
export const CODE_RE = /^\d{6}$/;

// Largest multiple of 1e6 that fits in a uint32. Draws at or above it are
// rejected, so `% 1e6` maps the accepted range onto 000000..999999 uniformly.
const CODE_SPACE = 1_000_000;
const UNBIASED_LIMIT = Math.floor(0x1_0000_0000 / CODE_SPACE) * CODE_SPACE; // 4294000000

/** 6-digit login code by rejection sampling over 4 random bytes (no modulo bias). */
export function generateLoginCode(randomValues: (n: number) => Uint8Array): string {
  for (;;) {
    const bytes = randomValues(4);
    const n = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
    if (n < UNBIASED_LIMIT) return String(n % CODE_SPACE).padStart(6, "0");
  }
}

export function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Same normalization as the SQL side (`lower(btrim(email))`); null when malformed. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}
