import type React from 'react';
import { sanitizeExternalUrl } from '../../lib/security';

/** Espelha o sanitizeUrl do CRM (apps/crm/src/utils/security.ts): `//host` (protocol-relative)
 *  vira '#'; caminhos internos (`/`, `./`, `../`, `#`) passam direto; o resto vai para
 *  sanitizeExternalUrl (só http(s) sem credenciais). */
export function previewHref(href: string): string {
  // O browser remove tab/LF/CR de QUALQUER posição antes de interpretar a URL (WHATWG),
  // então `/\t/evil.com` vira `//evil.com`. Normalizar igual antes de decidir. Links markdown
  // chegam aqui com esses caracteres já percent-encoded (`%09`/`%0a`/`%0d`) pelo parser de
  // origem (micromark, via mdast-util-to-hast normalizeUri), então a mesma limpeza precisa
  // cobrir as duas formas -- igual já valia para `\` cru vs. `%5c`.
  const stripped = href.replace(/[\t\r\n]|%0[9ad]/gi, '');
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

/** Tokens do CRM com que o PopupCard é pintado na prévia (claro = padrão do componente). */
const DARK_VARS = {
  '--card-bg': '#12151a',
  '--text-main': '#e8eaf0',
  '--text-muted': '#9ca3af',
  '--border-color': '#1e2430',
  '--cta-bg': '#e8eaf0',
  '--cta-fg': '#12151a',
} as React.CSSProperties;

export type PreviewTheme = 'light' | 'dark';

/** Fundo da prévia: o fundo de página do CRM em cada tema. */
export function previewStageStyle(theme: PreviewTheme): React.CSSProperties {
  return theme === 'dark' ? { ...DARK_VARS, background: '#0a0c0f' } : { background: '#eef0f3' };
}
