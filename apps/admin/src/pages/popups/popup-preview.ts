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

/** Tokens do CRM (apps/crm/style.css, :root e [data-theme='dark']) com que o PopupCard é
 *  pintado ao vivo. Os dois temas vão explícitos: o admin não carrega o style.css do CRM, e o
 *  fallback embutido no card não é igual ao CRM em tudo (fontes, borda). */
const FONT_VARS = {
  '--font-main': "'SF Pro Text', sans-serif",
  '--font-heading': "'SF Pro Display', sans-serif",
};

const THEME_VARS = {
  light: {
    ...FONT_VARS,
    '--card-bg': '#ffffff',
    '--text-main': '#12151a',
    '--text-muted': '#374151',
    '--border-color': 'rgba(30, 36, 48, 0.102)',
    '--cta-bg': '#12151a',
    '--cta-fg': '#ffffff',
  },
  dark: {
    ...FONT_VARS,
    '--card-bg': '#12151a',
    '--text-main': '#e8eaf0',
    '--text-muted': '#9ca3af',
    '--border-color': '#1e2430',
    '--cta-bg': '#e8eaf0',
    '--cta-fg': '#12151a',
  },
} as const;

export type PreviewTheme = 'light' | 'dark';
/** Visual do CRM: Vidro (padrão no computador, flag do workspace) ou clássico (iPhone e opt-out). */
export type PreviewLook = 'vidro' | 'classic';

/** Largura do popup no CRM (GlobalPopupHost: `w-[calc(100%-32px)] max-w-[420px]`). */
export const LIVE_POPUP_MAX_WIDTH = 420;

/** O Vidro só remapeia a borda dos tokens que o card lê (vidro-body/tokens.css: `--vd-sep`). */
const VIDRO_BORDER = {
  light: 'rgba(60, 60, 67, 0.12)',
  dark: 'rgba(235, 235, 245, 0.09)',
} as const;

/** Fundo da página do CRM que fica sob o véu: `--bg-color` no clássico, o `.app-container` do Vidro. */
const PAGE_BG: Record<PreviewLook, Record<PreviewTheme, React.CSSProperties>> = {
  classic: { light: { background: '#fdfdfd' }, dark: { background: '#0a0c0f' } },
  vidro: {
    light: {
      backgroundColor: '#eceef3',
      backgroundImage: [
        'radial-gradient(42rem 42rem at 6% 8%, rgba(255, 191, 48, 0.3), transparent 60%)',
        'radial-gradient(40rem 40rem at 92% 12%, rgba(57, 132, 255, 0.18), transparent 60%)',
        'radial-gradient(40rem 40rem at 80% 96%, rgba(245, 66, 200, 0.12), transparent 60%)',
        'radial-gradient(36rem 36rem at 12% 92%, rgba(106, 201, 208, 0.22), transparent 62%)',
      ].join(', '),
    },
    dark: {
      backgroundColor: '#0a0c0f',
      backgroundImage: [
        'radial-gradient(42rem 42rem at 6% 8%, rgba(234, 179, 8, 0.32), transparent 60%)',
        'radial-gradient(40rem 40rem at 92% 12%, rgba(57, 132, 255, 0.3), transparent 60%)',
        'radial-gradient(40rem 40rem at 80% 96%, rgba(245, 66, 200, 0.24), transparent 60%)',
        'radial-gradient(36rem 36rem at 12% 92%, rgba(106, 201, 208, 0.24), transparent 62%)',
      ].join(', '),
    },
  },
};

/** Véu do popup: o DialogOverlay do CRM (bg-black/80) ou o `--vd-overlay` do Vidro com blur(2px). */
const SCRIM: Record<PreviewLook, Record<PreviewTheme, React.CSSProperties>> = {
  classic: {
    light: { background: 'rgba(0, 0, 0, 0.8)' },
    dark: { background: 'rgba(0, 0, 0, 0.8)' },
  },
  vidro: {
    light: {
      background: 'rgba(18, 21, 26, 0.32)',
      backdropFilter: 'blur(2px)',
      WebkitBackdropFilter: 'blur(2px)',
    },
    dark: {
      background: 'rgba(0, 0, 0, 0.55)',
      backdropFilter: 'blur(2px)',
      WebkitBackdropFilter: 'blur(2px)',
    },
  },
};

/** Tokens com que o PopupCard é pintado, no tema e no visual escolhidos. */
export function previewThemeVars(theme: PreviewTheme, look: PreviewLook): React.CSSProperties {
  const vars: Record<string, string> = { ...THEME_VARS[theme] };
  if (look === 'vidro') vars['--border-color'] = VIDRO_BORDER[theme];
  return vars as React.CSSProperties;
}

/** Palco da prévia: os tokens do card mais o fundo da página do CRM (o véu vai por cima). */
export function previewStageStyle(theme: PreviewTheme, look: PreviewLook): React.CSSProperties {
  return { ...previewThemeVars(theme, look), ...PAGE_BG[look][theme] };
}

/** Só o fundo da página do CRM (a tela cheia o pinta atrás do véu, no lugar do Admin). */
export function previewPageStyle(theme: PreviewTheme, look: PreviewLook): React.CSSProperties {
  return PAGE_BG[look][theme];
}

export function previewScrimStyle(theme: PreviewTheme, look: PreviewLook): React.CSSProperties {
  return SCRIM[look][theme];
}
