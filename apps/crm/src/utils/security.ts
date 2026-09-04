export function sanitizeExternalUrl(value: string | undefined | null): string {
  if (!value) return '#';
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

/** Allows safe in-app relative URLs in addition to credential-free HTTP(S). */
export function sanitizeUrl(value: string | undefined | null): string {
  if (!value) return '#';
  const trimmed = value.trim();
  // `//host` é protocol-relative; o browser trata `\` como `/` em http(s), então `/\host` também é.
  // Links markdown chegam aqui já com o `\` percent-encoded (`%5C`) pelo parser de origem
  // (micromark), então o mesmo prefixo bloqueado precisa cobrir a forma crua e a codificada.
  if (/^\/(?:[/\\]|%5c)/i.test(trimmed)) return '#';
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
