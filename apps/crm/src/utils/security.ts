export function sanitizeExternalUrl(value: string | undefined | null): string {
  if (!value) return '#';
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) return '#';
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : '#';
  } catch {
    return '#';
  }
}

/** Allows safe in-app relative URLs in addition to credential-free HTTP(S). */
export function sanitizeUrl(value: string | undefined | null): string {
  if (!value) return '#';
  const trimmed = value.trim();
  if (trimmed.startsWith('//')) return '#';
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('#')
  ) {
    return trimmed;
  }
  return sanitizeExternalUrl(trimmed);
}

export function openExternalUrl(value: string | undefined | null): Window | null {
  const safe = sanitizeExternalUrl(value);
  if (safe === '#') return null;
  return window.open(safe, '_blank', 'noopener,noreferrer');
}
