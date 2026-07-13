export function sanitizeExternalUrl(value: string | null | undefined): string {
  if (!value) return '#';
  const trimmed = value.trim();
  try {
    const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
    const candidate = hasScheme || trimmed.startsWith('//') ? trimmed : `https://${trimmed}`;
    const url = new URL(candidate);
    if (url.username || url.password) return '#';
    if (!hasScheme && !url.hostname.includes('.')) return '#';
    return url.protocol === 'http:' || url.protocol === 'https:' ? candidate : '#';
  } catch {
    return '#';
  }
}
