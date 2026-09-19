const MAX_LINK_URL_LENGTH = 2048;

/**
 * Normaliza a URL digitada num link útil. Devolve a string a salvar, ou null
 * quando não dá para aceitar. Só http/https, sem credenciais embutidas, sem
 * espaços, com host contendo ponto e até 2048 caracteres já normalizada. URL sem
 * protocolo ganha `https://`.
 * Mantém o texto como digitado (não reserializa) para o usuário reconhecer o
 * que salvou.
 */
export function normalizeLinkUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.startsWith('//')) return null;
  const hasScheme = /^[a-z][a-z\d+-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  // Mede a string que vai para o banco (com o https:// prefixado), para casar
  // com o CHECK char_length(url) <= 2048 de cliente_links.
  if (candidate.length > MAX_LINK_URL_LENGTH) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (!parsed.hostname.includes('.')) return null;
    // O CHECK do banco exige a barra dupla literal; `https:/x.com` passa no
    // new URL mas seria recusado pelo banco.
    if (!/^https?:\/\//i.test(candidate)) return null;
    return candidate;
  } catch {
    return null;
  }
}

/** Host sem `www.`, para exibir sob o título do link. */
export function linkDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
