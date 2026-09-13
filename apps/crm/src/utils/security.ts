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
  // O browser remove tab/LF/CR de QUALQUER posição antes de interpretar a URL (WHATWG),
  // então `/\t/evil.com` vira `//evil.com`. Normalizar igual antes de decidir. Links markdown
  // chegam aqui com esses caracteres já percent-encoded (`%09`/`%0a`/`%0d`) pelo parser de
  // origem (micromark, via mdast-util-to-hast normalizeUri), então a mesma limpeza precisa
  // cobrir as duas formas -- igual já valia para `\` cru vs. `%5c`.
  const stripped = trimmed.replace(/[\t\r\n]|%0[9ad]/gi, '');
  // `//host` é protocol-relative; o browser trata `\` como `/` em http(s), então `/\host` também é.
  // Links markdown chegam aqui já com o `\` percent-encoded (`%5C`) pelo parser de origem
  // (micromark), então o mesmo prefixo bloqueado precisa cobrir a forma crua e a codificada.
  if (/^\/(?:[/\\]|%5c)/i.test(stripped)) return '#';
  if (
    stripped.startsWith('/') ||
    stripped.startsWith('./') ||
    stripped.startsWith('../') ||
    stripped.startsWith('#')
  ) {
    return stripped;
  }
  return sanitizeExternalUrl(stripped);
}

export function openExternalUrl(value: string | undefined | null): Window | null {
  const safe = sanitizeExternalUrl(value);
  if (safe === '#') return null;
  return window.open(safe, '_blank', 'noopener,noreferrer');
}
