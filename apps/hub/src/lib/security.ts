export function sanitizeExternalUrl(value: string | null | undefined): string {
  if (!value) return '#';
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.username || url.password) return '#';
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : '#';
  } catch {
    return '#';
  }
}
