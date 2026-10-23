/** Copy of `sanitizeUrl` / `sanitizeExternalUrl` from
 * `apps/crm/src/utils/security.ts`: packages/ui must never import from apps/,
 * and the blog renderer is shared by the CRM page, its static mirror and the
 * Admin preview. `packages/ui/__tests__/blog-render.test.tsx` checks that both
 * agree on a table of inputs; change them together. */

function safeExternalHref(value: string): string {
  const trimmed = value.trim();
  try {
    const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
    const candidate = hasScheme || trimmed.startsWith('//') ? trimmed : `https://${trimmed}`;
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password) return '#';
    if (!hasScheme && !parsed.hostname.includes('.')) return '#';
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : '#';
  } catch {
    return '#';
  }
}

/** Safe in-app relative URLs plus credential-free http(s); anything else is `#`. */
export function safeHref(value: string | undefined | null): string {
  if (!value) return '#';
  const trimmed = value.trim();
  // Browsers drop tab/LF/CR anywhere in a URL (WHATWG), so `/\t/evil.com`
  // becomes `//evil.com`. Markdown links arrive percent-encoded (`%09`).
  const stripped = trimmed.replace(/[\t\r\n]|%0[9ad]/gi, '');
  // `//host` and `/\host` (also `%5c`) are protocol-relative.
  if (/^\/(?:[/\\]|%5c)/i.test(stripped)) return '#';
  if (
    stripped.startsWith('/') ||
    stripped.startsWith('./') ||
    stripped.startsWith('../') ||
    stripped.startsWith('#')
  ) {
    return stripped;
  }
  return safeExternalHref(stripped);
}

/** True for an absolute http(s) URL, i.e. a link that leaves the site. */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}
