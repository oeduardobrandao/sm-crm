// Resolvedor de tema do relatório de blocos. Fonte única para editor (CRM),
// viewer (Hub) e print (PDF). Modo herdado (theme/fonts ausentes) emite o
// mínimo — byte-idêntico ao comportamento pré-temas. O resolveAccent LEGADO
// (_shared/report-template/theme.ts) segue intocado para o gerador v2; aqui
// reproduzimos o clamp dele e trocamos a escolha de foreground por contraste
// WCAG real (spec 2026-08-24 §Tokens).
import type { ReportDocSnapshot, ReportLayout } from './types';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function hexToRgb(hex: string): [number, number, number] {
  const int = parseInt(hex.slice(1), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

// Clamp LEGADO usa esta luminância barata (gamma, não linearizada) com o
// mesmo limiar 0.85 — paridade visual com resolveAccent, de propósito.
function legacyLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

function clampAccent(hex: string | null | undefined): string {
  let acc = hex && HEX_RE.test(hex) ? hex : '#171717';
  if (legacyLuminance(acc) > 0.85) acc = '#171717';
  return acc;
}

function pickAccentFg(acc: string, ink: string): string {
  return contrastRatio('#ffffff', acc) >= contrastRatio(ink, acc) ? '#ffffff' : ink;
}

/** Accent usável COMO TEXTO sobre bg: escurece em direção à tinta até 4.5:1;
 * fallback = a própria tinta. */
function deriveAccentText(acc: string, bg: string, ink: string): string {
  for (let t = 0; t <= 1.0001; t += 0.1) {
    const candidate = mixHex(acc, ink, t);
    if (contrastRatio(candidate, bg) >= 4.5) return candidate;
  }
  return ink;
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

export function resolveReportTheme(layout: ReportLayout, snapshot: ReportDocSnapshot): ReportTheme {
  const acc = clampAccent(layout.accent ?? snapshot.branding.accent_color);
  const theme = layout.theme;
  const fonts = layout.fonts;

  const vars: Record<string, string> = { '--rb-accent': acc };

  if (theme) {
    const def = THEME_DEFS[theme];
    const soft = mixHex(acc, def.bg, 0.9);
    vars['--rb-accent-fg'] = pickAccentFg(acc, def.ink);
    vars['--rb-accent-text'] = deriveAccentText(acc, def.bg, def.ink);
    vars['--rb-bg'] = def.bg;
    vars['--rb-ink'] = def.ink;
    vars['--rb-ink-soft'] = def.inkSoft;
    vars['--rb-border'] = def.border;
    vars['--rb-radius'] = def.radius;
    vars['--rb-soft'] = soft;
    vars['--rb-surface'] =
      def.surface === 'white' ? '#ffffff' : def.surface === 'transparent' ? 'transparent' : soft;
  } else {
    // Modo HERDADO: byte-idêntico ao pré-temas. accent-text = accent cru
    // (o chip "Formato líder" usa a cor crua hoje; mudar seria regressão
    // visual em doc legado).
    vars['--rb-accent-fg'] = pickAccentFg(acc, '#171717');
    vars['--rb-accent-text'] = acc;
  }

  let fontHref: string | null = null;
  if (fonts) {
    const pairing = FONT_PAIRINGS[fonts];
    vars['--rb-font-display'] = pairing.display;
    vars['--rb-font-body'] = pairing.body;
    fontHref = pairing.googleHref;
  }

  return { vars, themeClass: theme ? `rb-theme-${theme}` : null, fontHref };
}
