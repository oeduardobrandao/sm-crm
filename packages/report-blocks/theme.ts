// Resolvedor de tema do relatório de blocos. Fonte única para editor (CRM),
// viewer (Hub) e print (PDF). Modo herdado (theme/fonts ausentes) emite o
// mínimo — byte-idêntico ao comportamento pré-temas. O resolveAccent LEGADO
// (_shared/report-template/theme.ts) segue intocado para o gerador v2; aqui
// reproduzimos o clamp dele e trocamos a escolha de foreground por contraste
// WCAG real (spec 2026-08-24 §Tokens).
import type { ReportDocSnapshot, ReportLayout, SnapshotHubTheme } from './types';
import { REPORT_FONT_IDS, REPORT_THEME_IDS } from './types';
import {
  PALETTES,
  RADIUS_CARD,
  HUB_DISPLAY_FONTS,
  HUB_BODY_FONTS,
  buildGoogleFontsHref,
} from '../hub-theme/theme';
export { PALETTES } from '../hub-theme/theme';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function hexToRgb(hex: string): [number, number, number] {
  const int = parseInt(hex.slice(1), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** Razão de contraste WCAG 2.x entre duas cores #rrggbb. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mistura sRGB simples (byte a byte), t = fração da cor b. */
function mixHex(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  return toHex([0, 1, 2].map((i) => ra[i] * (1 - t) + rb[i] * t) as [number, number, number]);
}

// Cor de marca CLARA é preservada de propósito (decisão 2026-08-24, revertendo
// o clamp herdado do pipeline legado): a capa e os preenchimentos usam a cor
// crua com o foreground de maior contraste por cima; só os usos como TEXTO
// (--rb-accent-text) e como TRAÇO fino (--rb-accent-line) derivam tons
// escurecidos até ficarem legíveis. Hex inválido segue caindo no neutro.
function clampAccent(hex: string | null | undefined): string {
  return hex && HEX_RE.test(hex) ? hex : '#171717';
}

export function pickAccentFg(acc: string, ink: string): string {
  return contrastRatio('#ffffff', acc) >= contrastRatio(ink, acc) ? '#ffffff' : ink;
}

/** Escurece o accent em direção à tinta até atingir `ratio` de contraste
 * sobre bg; fallback = a própria tinta. 4.5 para texto (WCAG AA), 3.0 para
 * traços/gráficos (WCAG 1.4.11, contraste não-textual). */
function deriveVisible(acc: string, bg: string, ink: string, ratio: number): string {
  for (let t = 0; t <= 1.0001; t += 0.1) {
    const candidate = mixHex(acc, ink, t);
    if (contrastRatio(candidate, bg) >= ratio) return candidate;
  }
  return ink;
}

function deriveAccentText(acc: string, bg: string, ink: string): string {
  return deriveVisible(acc, bg, ink, 4.5);
}

function deriveAccentLine(acc: string, bg: string, ink: string): string {
  return deriveVisible(acc, bg, ink, 3.0);
}

export interface FontPairing {
  label: string;
  display: string;
  body: string;
  googleHref: string | null;
}

const SYSTEM_STACK = "-apple-system, 'Segoe UI', Roboto, sans-serif";

export const FONT_PAIRINGS: Record<'system' | 'fraunces' | 'grotesk' | 'playfair', FontPairing> = {
  system: { label: 'Sistema', display: SYSTEM_STACK, body: SYSTEM_STACK, googleHref: null },
  fraunces: {
    label: 'Fraunces + Instrument Sans',
    display: "'Fraunces', Georgia, serif",
    body: `'Instrument Sans', ${SYSTEM_STACK}`,
    googleHref:
      'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Instrument+Sans:wght@400;600;700&display=swap',
  },
  grotesk: {
    label: 'Space Grotesk + Inter',
    display: "'Space Grotesk', sans-serif",
    body: `'Inter', ${SYSTEM_STACK}`,
    googleHref:
      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;600;700&display=swap',
  },
  playfair: {
    label: 'Playfair Display + Source Sans',
    display: "'Playfair Display', Georgia, serif",
    body: `'Source Sans 3', ${SYSTEM_STACK}`,
    googleHref:
      'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Source+Sans+3:wght@400;600;700&display=swap',
  },
};

interface ThemeDef {
  bg: string;
  ink: string;
  inkSoft: string;
  border: string;
  radius: string;
  /** base da mistura do --rb-soft (fundo do tema). */
  surface: 'white' | 'transparent' | 'soft';
}

const THEME_DEFS: Record<'clean' | 'editorial' | 'bold', ThemeDef> = {
  clean: {
    bg: '#ffffff',
    ink: '#12151a',
    inkSoft: 'rgba(18, 21, 26, 0.65)',
    border: 'rgba(0, 0, 0, 0.08)',
    radius: '12px',
    surface: 'white',
  },
  editorial: {
    bg: '#faf6ee',
    ink: '#2a2118',
    inkSoft: 'rgba(42, 33, 24, 0.65)',
    border: 'rgba(42, 33, 24, 0.25)',
    radius: '0px',
    surface: 'transparent',
  },
  bold: {
    bg: '#ffffff',
    ink: '#12151a',
    inkSoft: 'rgba(18, 21, 26, 0.65)',
    border: 'rgba(0, 0, 0, 0.08)',
    radius: '12px',
    surface: 'soft',
  },
};

export interface ReportTheme {
  vars: Record<string, string>;
  themeClass: string | null;
  fontHref: string | null;
}

const HUB_DEFAULT_THEME: SnapshotHubTheme = {
  surface: 'neutral',
  font_display: 'fraunces',
  font_body: 'instrument-sans',
  radius: 'soft',
  card_style: 'filled',
};

export function resolveReportTheme(layout: ReportLayout, snapshot: ReportDocSnapshot): ReportTheme {
  const acc = clampAccent(layout.accent ?? snapshot.branding.accent_color);
  // Renderers são tolerantes (contrato da spec): valor persistido fora dos
  // enums (possível em row anterior ao trigger de 20260824000001) degrada
  // para o modo herdado em vez de indexar THEME_DEFS/FONT_PAIRINGS com
  // undefined e derrubar o documento inteiro.
  const theme = (REPORT_THEME_IDS as readonly unknown[]).includes(layout.theme)
    ? layout.theme
    : undefined;
  const fonts = (REPORT_FONT_IDS as readonly unknown[]).includes(layout.fonts)
    ? layout.fonts
    : undefined;

  const vars: Record<string, string> = { '--rb-accent': acc };
  let fontHref: string | null = null;

  if (theme === 'hub') {
    // Deriva do Personalizar Hub do workspace (congelado no snapshot na
    // geração/refresh, Task 4) em vez de um THEME_DEFS fixo -- branch próprio
    // porque THEME_DEFS não tem entrada 'hub' e porque a fonte vem de um
    // mapa de 6+5 opções, não de FONT_PAIRINGS. Cada lookup por id
    // persistido cai no default quando o valor é desconhecido: data_snapshot
    // é JSON sem tipo em runtime, e um documento antigo (ou uma fonte do
    // Hub descontinuada) não pode quebrar a renderização.
    const hubCfg = snapshot.branding.hub_theme ?? HUB_DEFAULT_THEME;
    const palette = PALETTES[hubCfg.surface]?.light ?? PALETTES.neutral.light;
    const bg = palette.bg;
    const ink = palette.txt;
    const border =
      hubCfg.card_style === 'outline'
        ? palette.bd2
        : hubCfg.card_style === 'tonal'
          ? 'transparent'
          : palette.bd;
    const radius = RADIUS_CARD[hubCfg.radius] ?? RADIUS_CARD.soft;
    const surface =
      hubCfg.card_style === 'outline'
        ? 'transparent'
        : hubCfg.card_style === 'tonal'
          ? palette.soft
          : palette.card;
    const soft = mixHex(acc, bg, 0.9);
    const accentFg = pickAccentFg(acc, ink);
    const accentText = deriveAccentText(acc, bg, ink);
    vars['--rb-accent-fg'] = accentFg;
    vars['--rb-accent-text'] = accentText;
    vars['--rb-accent-line'] = deriveAccentLine(acc, bg, ink);
    vars['--rb-bg'] = bg;
    vars['--rb-ink'] = ink;
    vars['--rb-ink-soft'] = palette.tx2;
    vars['--rb-border'] = border;
    vars['--rb-radius'] = radius;
    vars['--rb-soft'] = soft;
    vars['--rb-surface'] = surface;
    if (!fonts) {
      const fontDisplay = HUB_DISPLAY_FONTS[hubCfg.font_display] ?? HUB_DISPLAY_FONTS.fraunces;
      const fontBody = HUB_BODY_FONTS[hubCfg.font_body] ?? HUB_BODY_FONTS['instrument-sans'];
      vars['--rb-font-display'] = fontDisplay.css;
      vars['--rb-font-body'] = fontBody.css;
      fontHref = buildGoogleFontsHref(hubCfg.font_display, hubCfg.font_body, {
        includeDefaults: true,
      });
    }
  } else if (theme) {
    const def = THEME_DEFS[theme];
    const soft = mixHex(acc, def.bg, 0.9);
    const accentFg = pickAccentFg(acc, def.ink);
    const accentText = deriveAccentText(acc, def.bg, def.ink);
    vars['--rb-accent-fg'] = accentFg;
    vars['--rb-accent-text'] = accentText;
    vars['--rb-accent-line'] = deriveAccentLine(acc, def.bg, def.ink);
    vars['--rb-bg'] = def.bg;
    vars['--rb-ink'] = def.ink;
    vars['--rb-ink-soft'] = def.inkSoft;
    vars['--rb-border'] = def.border;
    vars['--rb-radius'] = def.radius;
    vars['--rb-soft'] = soft;
    vars['--rb-surface'] =
      def.surface === 'white' ? '#ffffff' : def.surface === 'transparent' ? 'transparent' : soft;
    // Destaque preenchido é SÓ capa e cabeçalho de seção, e SÓ no bold (spec,
    // mapa visual por bloco) — clean/editorial/herdado usam os fallbacks
    // inline dos componentes (visual atual, sem cor de marca na capa).
    if (theme === 'bold') {
      vars['--rb-cover-bg'] = acc;
      vars['--rb-cover-fg'] = accentFg;
      vars['--rb-section-title'] = accentText;
    }
  } else {
    // Modo HERDADO: para accent escuro/médio, idêntico ao pré-temas (as
    // derivações devolvem a própria cor quando ela já contrasta). Para accent
    // CLARO o comportamento mudou de propósito (2026-08-24): antes o clamp
    // trocava tudo por #171717; agora a cor crua fica nos preenchimentos e
    // texto/traço derivam tons legíveis contra o papel claro assumido.
    vars['--rb-accent-fg'] = pickAccentFg(acc, '#171717');
    vars['--rb-accent-text'] = deriveAccentText(acc, '#ffffff', '#171717');
    vars['--rb-accent-line'] = deriveAccentLine(acc, '#ffffff', '#171717');
  }

  if (fonts) {
    const pairing = FONT_PAIRINGS[fonts];
    vars['--rb-font-display'] = pairing.display;
    vars['--rb-font-body'] = pairing.body;
    fontHref = pairing.googleHref;
  }

  return { vars, themeClass: theme ? `rb-theme-${theme}` : null, fontHref };
}
