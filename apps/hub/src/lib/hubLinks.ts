/** Append the focused-post path to a hub base URL (relative or absolute). */
export function buildHubPostLink(base: string, postId: number): string {
  return `${base.replace(/\/$/, '')}/postagens/${postId}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPACT_UUID_RE = /^[0-9a-f]{32}$/i;

/**
 * The token as it goes in a link: the UUID without hyphens. WhatsApp reads a bare
 * UUID as a Pix random key ("Copiar chave Pix") and stops linking the URL around it.
 * Anything that isn't a UUID passes through unchanged.
 */
export function compactHubToken(token: string): string {
  return UUID_RE.test(token) ? token.replace(/-/g, '').toLowerCase() : token;
}

/**
 * The token as the API expects it: the hyphenated UUID. Links carry either form
 * (old ones have the hyphens), so every route param goes through this first.
 */
export function canonicalHubToken(token: string): string {
  if (!COMPACT_UUID_RE.test(token)) return token;
  const t = token.toLowerCase();
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-${t.slice(12, 16)}-${t.slice(16, 20)}-${t.slice(20)}`;
}
