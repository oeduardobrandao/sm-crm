/** Append the focused-post path to a hub base URL (relative or absolute). */
export function buildHubPostLink(base: string, postId: number): string {
  return `${base.replace(/\/$/, '')}/postagens/${postId}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Hub token as it goes in a link: the UUID without hyphens. WhatsApp reads a
 * bare UUID as a Pix random key ("Copiar chave Pix") and stops linking the URL
 * around it. The Hub accepts both forms (apps/hub/src/lib/hubLinks.ts).
 */
export function compactHubToken(token: string): string {
  return UUID_RE.test(token) ? token.replace(/-/g, '').toLowerCase() : token;
}
