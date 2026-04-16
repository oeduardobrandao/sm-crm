/**
 * Sanitize a URL to prevent URI injection attacks.
 * Only allows http: and https: schemes. Returns '#' for anything else.
 */
export function sanitizeUrl(url: string | undefined | null): string {
  if (!url) return '#';
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return url.trim();
    }
    return '#';
  } catch {
    // URL constructor throws for relative paths like "/foo" and "//evil.com"
    // Relative paths starting with / (but not //) are safe to pass through
    const trimmed = url.trim();
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
    if (trimmed.startsWith('./') || trimmed.startsWith('../')) return trimmed;
    if (trimmed.startsWith('#')) return trimmed;
    return '#';
  }
}
