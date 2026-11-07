// Pure helpers for /workspace-setup: the slug rewrite, phone check and the `next` target.

// Letters NFD leaves whole, so stripping combining marks alone would drop them.
const NON_DECOMPOSING: ReadonlyArray<[RegExp, string]> = [
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ø/g, 'o'],
  [/ł/g, 'l'],
  [/đ/g, 'd'],
  [/þ/g, 'th'],
];

/**
 * Readable slug for a workspace name. Approximates the signup trigger's `unaccent` rule, but
 * only has to produce a valid, readable slug: the id suffix added by the caller keeps it
 * unique. A name with nothing readable (only emoji or symbols) becomes `workspace`.
 */
export function slugifyWorkspaceName(name: string): string {
  let s = name.toLowerCase();
  for (const [re, to] of NON_DECOMPOSING) s = s.replace(re, to);
  const slug = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'workspace';
}

/** The 8 hex characters the signup trigger appends to every workspace slug. */
export function workspaceSlugSuffix(workspaceId: string): string {
  return workspaceId.replace(/-/g, '').slice(0, 8);
}

/**
 * True only for the slug a blank-company signup gets (`workspace-<8hex>`). Any other slug may
 * already be in a hub link sent to a client, so it is never rewritten.
 */
export function isPlaceholderSlug(slug: string | null | undefined, workspaceId: string): boolean {
  return slug === `workspace-${workspaceSlugSuffix(workspaceId)}`;
}

/** A Brazilian phone with area code, typed with or without formatting or +55: 10 to 13 digits. */
export function isValidBrPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '').length;
  return digits >= 10 && digits <= 13;
}

const LOCAL_ORIGIN = 'http://setup.local';

/**
 * The `next` query value when it is a same-origin path other than the setup page itself,
 * else null (the caller falls back to /comecar). Blocks `//host`, `/\host`, absolute URLs and
 * control characters a browser would strip into one of those.
 */
export function safeNextPath(next: string | null): string | null {
  if (!next || !next.startsWith('/')) return null;
  if (next.startsWith('//') || next.startsWith('/\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  let url: URL;
  try {
    url = new URL(next, LOCAL_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== LOCAL_ORIGIN) return null;
  if (url.pathname.toLowerCase().replace(/\/+$/, '') === '/workspace-setup') return null;
  return next;
}
