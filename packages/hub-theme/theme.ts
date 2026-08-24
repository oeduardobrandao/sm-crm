export interface ResolvedHubTheme {
  vars: Record<string, string>;
}

export type HubSurface = 'neutral' | 'warm' | 'cool';
export type HubRadius = 'square' | 'soft' | 'pill';
export type HubCardStyle = 'filled' | 'outline' | 'tonal';

export interface HubThemeConfig {
  accent: string | null | undefined; // workspaces.brand_color
  surface: HubSurface;
  fontDisplay: string; // id into HUB_DISPLAY_FONTS; unknown ids fall back to 'fraunces'
  fontBody: string; // id into HUB_BODY_FONTS; unknown ids fall back to 'instrument-sans'
  radius: HubRadius;
  cardStyle: HubCardStyle;
  customized: boolean; // entitlement flag, resolved server-side
}

export const DEFAULT_HUB_THEME: HubThemeConfig = {
  accent: null,
  surface: 'neutral',
  fontDisplay: 'fraunces',
  fontBody: 'instrument-sans',
  radius: 'soft',
  cardStyle: 'filled',
  customized: false,
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function hexToRgb(hex: string): [number, number, number] {
  const int = parseInt(hex.slice(1), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface HubPalette {
  bg: string;
  card: string;
  txt: string;
  tx2: string;
  tx3: string;
  bd: string;
  bd2: string;
  soft: string;
}

// EXACT current LIGHT/DARK constants, byte-identical, minus the dead logoFilter key
// (removed: --hub-logo-filter is referenced nowhere in apps/hub/src).
const NEUTRAL_LIGHT: HubPalette = {
  bg: '#FAFAFA',
  card: '#FFFFFF',
  txt: '#171717',
  tx2: '#525252',
  tx3: '#8A8A8A',
  bd: 'rgba(0,0,0,.08)',
  bd2: 'rgba(0,0,0,.2)',
  soft: '#F4F4F4',
};

const NEUTRAL_DARK: HubPalette = {
  bg: '#0E0E0E',
  card: '#181818',
  txt: '#F5F5F5',
  tx2: '#B3B3B3',
  tx3: '#8A8A8A',
  bd: 'rgba(255,255,255,.09)',
  bd2: 'rgba(255,255,255,.22)',
  soft: '#242424',
};

const WARM_LIGHT: HubPalette = {
  bg: '#FAF7F2',
  card: '#FFFFFF',
  txt: '#1C1917',
  tx2: '#57534E',
  tx3: '#8A817C',
  bd: 'rgba(28,25,23,.08)',
  bd2: 'rgba(28,25,23,.2)',
  soft: '#F3EEE7',
};

const WARM_DARK: HubPalette = {
  bg: '#151210',
  card: '#1E1B18',
  txt: '#F5F0EB',
  tx2: '#B8B0A8',
  tx3: '#8A817C',
  bd: 'rgba(245,240,235,.09)',
  bd2: 'rgba(245,240,235,.22)',
  soft: '#282420',
};

const COOL_LIGHT: HubPalette = {
  bg: '#F7F9FB',
  card: '#FFFFFF',
  txt: '#0F1728',
  tx2: '#4B5563',
  tx3: '#8B94A3',
  bd: 'rgba(15,23,40,.08)',
  bd2: 'rgba(15,23,40,.2)',
  soft: '#EFF3F7',
};

const COOL_DARK: HubPalette = {
  bg: '#0D1017',
  card: '#161B24',
  txt: '#EEF2F7',
  tx2: '#A8B1BF',
  tx3: '#8B94A3',
  bd: 'rgba(238,242,247,.09)',
  bd2: 'rgba(238,242,247,.22)',
  soft: '#202734',
};

// Exported so tests (and any future consumer) read the same palette data resolveHubTheme()
// actually uses, instead of re-typing hexes into a second, driftable source of truth.
export const PALETTES: Record<HubSurface, { light: HubPalette; dark: HubPalette }> = {
  neutral: { light: NEUTRAL_LIGHT, dark: NEUTRAL_DARK },
  warm: { light: WARM_LIGHT, dark: WARM_DARK },
  cool: { light: COOL_LIGHT, dark: COOL_DARK },
};

export const RADIUS_CARD: Record<HubRadius, string> = {
  square: '0px',
  soft: '12px',
  pill: '18px',
};

// 'soft' matches the dominant Tailwind radius across shell/chrome .hub-btn-primary /
// .hub-btn-secondary call sites (rounded-lg, which resolves to 12px via the CRM
// stylesheet's --radius override that apps/hub/src/main.tsx imports) — see Task 5's
// radius survey in the report for the full tally. Pill-shaped controls (badges, the
// circular icon buttons, avatars) keep literal rounded-full/rounded-[...]px and are
// deliberately NOT wired to this token; they stay circular regardless of the radius
// preset.
const RADIUS_CTL: Record<HubRadius, string> = {
  square: '0px',
  soft: '12px',
  pill: '999px',
};

const CARD_BG: Record<HubCardStyle, string> = {
  filled: 'var(--hub-card)',
  outline: 'transparent',
  tonal: 'var(--hub-soft)',
};

const CARD_BD: Record<HubCardStyle, string> = {
  filled: 'var(--hub-bd)',
  outline: 'var(--hub-bd2)',
  tonal: 'transparent',
};

export interface HubFontOption {
  label: string;
  css: string;
  gf: string;
}

// Single source of truth for the Hub font allowlists. SQL CHECKs in migration
// 20260731000001_hub_branding_columns.sql mirror these ids exactly.
export const HUB_DISPLAY_FONTS: Record<string, HubFontOption> = {
  fraunces: {
    label: 'Fraunces',
    css: "'Fraunces', ui-serif, Georgia, serif",
    gf: 'Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700',
  },
  'playfair-display': {
    label: 'Playfair Display',
    css: "'Playfair Display', ui-serif, Georgia, serif",
    gf: 'Playfair+Display:wght@400;500;600;700',
  },
  'dm-serif-display': {
    label: 'DM Serif Display',
    css: "'DM Serif Display', ui-serif, Georgia, serif",
    gf: 'DM+Serif+Display',
  },
  'space-grotesk': {
    label: 'Space Grotesk',
    css: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    gf: 'Space+Grotesk:wght@400;500;600;700',
  },
  sora: {
    label: 'Sora',
    css: "'Sora', ui-sans-serif, system-ui, sans-serif",
    gf: 'Sora:wght@400;500;600;700',
  },
  lora: {
    label: 'Lora',
    css: "'Lora', ui-serif, Georgia, serif",
    gf: 'Lora:wght@400;500;600;700',
  },
};

export const HUB_BODY_FONTS: Record<string, HubFontOption> = {
  'instrument-sans': {
    label: 'Instrument Sans',
    css: "'Instrument Sans', ui-sans-serif, system-ui, sans-serif",
    gf: 'Instrument+Sans:wght@400;500;600;700',
  },
  inter: {
    label: 'Inter',
    css: "'Inter', ui-sans-serif, system-ui, sans-serif",
    gf: 'Inter:wght@400;500;600;700',
  },
  'dm-sans': {
    label: 'DM Sans',
    css: "'DM Sans', ui-sans-serif, system-ui, sans-serif",
    gf: 'DM+Sans:wght@400;500;600;700',
  },
  manrope: {
    label: 'Manrope',
    css: "'Manrope', ui-sans-serif, system-ui, sans-serif",
    gf: 'Manrope:wght@400;500;600;700',
  },
  'public-sans': {
    label: 'Public Sans',
    css: "'Public Sans', ui-sans-serif, system-ui, sans-serif",
    gf: 'Public+Sans:wght@400;500;600;700',
  },
};

export const HUB_FONT_PAIRINGS: { display: string; body: string; label: string }[] = [
  { display: 'fraunces', body: 'instrument-sans', label: 'Editorial' },
  { display: 'playfair-display', body: 'inter', label: 'Clássico' },
  { display: 'space-grotesk', body: 'inter', label: 'Moderno' },
  { display: 'lora', body: 'public-sans', label: 'Sóbrio' },
];

const DEFAULT_DISPLAY_ID = 'fraunces';
const DEFAULT_BODY_ID = 'instrument-sans';

export function buildGoogleFontsHref(
  displayId: string,
  bodyId: string,
  opts?: { includeDefaults?: boolean },
): string | null {
  const includeDefaults = opts?.includeDefaults ?? false;
  const gfs: string[] = [];

  // `in` distingue "id desconhecido" de "id igual ao default": sem essa checagem, um id
  // desconhecido com includeDefaults false emitiria a família default em vez de null.
  const display = HUB_DISPLAY_FONTS[displayId] ?? HUB_DISPLAY_FONTS[DEFAULT_DISPLAY_ID];
  const displayKnown = displayId in HUB_DISPLAY_FONTS;
  if ((displayKnown && displayId !== DEFAULT_DISPLAY_ID) || includeDefaults) gfs.push(display.gf);

  const body = HUB_BODY_FONTS[bodyId] ?? HUB_BODY_FONTS[DEFAULT_BODY_ID];
  const bodyKnown = bodyId in HUB_BODY_FONTS;
  if ((bodyKnown && bodyId !== DEFAULT_BODY_ID) || includeDefaults) gfs.push(body.gf);

  if (gfs.length === 0) return null;

  return `https://fonts.googleapis.com/css2?${gfs.map((gf) => `family=${gf}`).join('&')}&display=swap`;
}

export function resolveHubTheme(config: HubThemeConfig, dark: boolean): ResolvedHubTheme {
  const palette = PALETTES[config.surface] ?? PALETTES.neutral;
  const t = dark ? palette.dark : palette.light;

  // Accent clamp pipeline: unchanged from the pre-customization resolver. --hub-acc /
  // --hub-acc-fg keep this behavior regardless of `customized` (the calendar keeps its
  // accent on all plans).
  let acc = config.accent && HEX_RE.test(config.accent) ? config.accent : '#171717';
  const lum = relativeLuminance(acc);
  if (dark && lum < 0.18) acc = '#F5F5F5';
  else if (!dark && lum > 0.85) acc = '#171717';
  const accFg = relativeLuminance(acc) > 0.55 ? '#171717' : '#ffffff';

  const primary = config.customized ? acc : 'var(--hub-txt)';
  const primaryFg = config.customized ? accFg : 'var(--hub-card)';
  const ring = config.customized
    ? `color-mix(in srgb, ${acc} 22%, transparent)`
    : 'color-mix(in srgb, var(--hub-txt) 15%, transparent)';

  const radiusCard = RADIUS_CARD[config.radius] ?? RADIUS_CARD.soft;
  const radiusCtl = RADIUS_CTL[config.radius] ?? RADIUS_CTL.soft;

  const cardBg = CARD_BG[config.cardStyle] ?? CARD_BG.filled;
  const cardBd = CARD_BD[config.cardStyle] ?? CARD_BD.filled;

  const fontDisplay =
    HUB_DISPLAY_FONTS[config.fontDisplay] ?? HUB_DISPLAY_FONTS[DEFAULT_DISPLAY_ID];
  const fontBody = HUB_BODY_FONTS[config.fontBody] ?? HUB_BODY_FONTS[DEFAULT_BODY_ID];

  return {
    vars: {
      '--hub-bg': t.bg,
      '--hub-card': t.card,
      '--hub-txt': t.txt,
      '--hub-tx2': t.tx2,
      '--hub-tx3': t.tx3,
      '--hub-bd': t.bd,
      '--hub-bd2': t.bd2,
      '--hub-soft': t.soft,
      '--hub-acc': acc,
      '--hub-acc-fg': accFg,
      '--hub-font-display': fontDisplay.css,
      '--hub-font-sans': fontBody.css,
      '--hub-primary': primary,
      '--hub-primary-fg': primaryFg,
      '--hub-ring': ring,
      '--hub-r-card': radiusCard,
      '--hub-r-ctl': radiusCtl,
      '--hub-card-bg': cardBg,
      '--hub-card-bd': cardBd,
    },
  };
}
