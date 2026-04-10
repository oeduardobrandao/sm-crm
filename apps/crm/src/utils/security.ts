/**
 * Sanitize a URL to prevent javascript: and data: URI injections.
 * Returns '#' for unsafe URLs.
 */
export function sanitizeUrl(url: string | undefined | null): string {
  if (!url) return '#';
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:')) return '#';
  return url;
}
