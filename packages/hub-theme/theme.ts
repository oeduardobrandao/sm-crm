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

export type HubLook = 'classic' | 'pauta';

const INK = '#171717';

/** WCAG 2.x relative luminance (gamma-corrected). The linear `relativeLuminance`
 * above stays for the classic accent clamp; Pauta decisions use this one.
 * report-blocks/theme.ts has its own copy; dedupe in the post-launch cleanup. */
export function wcagLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [wcagLuminance(a), wcagLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `#${A.map((v, i) =>
    Math.round(v + (B[i] - v) * t)
      .toString(16)
      .padStart(2, '0'),
  ).join('')}`;
}

/** Pauta fills (buttons, active nav, counters) with text on them. Keeps the brand
 * color when white or ink reaches 4.5:1 on it; otherwise darkens it toward ink in
 * 10% steps until white does. */
export function readablePrimary(acc: string): { primary: string; fg: string } {
  const white = contrastRatio('#ffffff', acc);
  const ink = contrastRatio(INK, acc);
  if (Math.max(white, ink) >= 4.5) return { primary: acc, fg: white >= ink ? '#ffffff' : INK };
  for (let i = 1; i <= 10; i++) {
    const candidate = mixHex(acc, INK, i / 10);
    if (contrastRatio('#ffffff', candidate) >= 4.5) return { primary: candidate, fg: '#ffffff' };
  }
  return { primary: INK, fg: '#ffffff' };
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
  tx3: '#707070',
  bd: 'rgba(0,0,0,.08)',
  bd2: 'rgba(0,0,0,.2)',
  soft: '#F4F4F4',
};

const NEUTRAL_DARK: HubPalette = {
  bg: '#0E0E0E',
  card: '#181818',
  txt: '#F5F5F5',
  tx2: '#B3B3B3',
  tx3: '#8D8D8D',
  bd: 'rgba(255,255,255,.09)',
  bd2: 'rgba(255,255,255,.22)',
  soft: '#242424',
};

const WARM_LIGHT: HubPalette = {
  bg: '#FAF7F2',
  card: '#FFFFFF',
  txt: '#1C1917',
  tx2: '#57534E',
  tx3: '#736B67',
  bd: 'rgba(28,25,23,.08)',
  bd2: 'rgba(28,25,23,.2)',
  soft: '#F3EEE7',
};

const WARM_DARK: HubPalette = {
  bg: '#151210',
  card: '#1E1B18',
  txt: '#F5F0EB',
  tx2: '#B8B0A8',
  tx3: '#938984',
  bd: 'rgba(245,240,235,.09)',
  bd2: 'rgba(245,240,235,.22)',
  soft: '#282420',
};

const COOL_LIGHT: HubPalette = {
  bg: '#F7F9FB',
  card: '#FFFFFF',
  txt: '#0F1728',
  tx2: '#4B5563',
  tx3: '#686F7A',
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

// Pauta's warm surface ("linho"). Neutral and cool are shared with the classic look.
// Becomes PALETTES.warm in the post-launch cleanup.
export const PAUTA_WARM: { light: HubPalette; dark: HubPalette } = {
  light: {
    bg: '#F8F5F3',
    card: '#FFFFFF',
    txt: '#1F1A17',
    tx2: '#5A514C',
    tx3: '#6F655F',
    bd: 'rgba(31,26,23,.08)',
    bd2: 'rgba(31,26,23,.2)',
    soft: '#F0EAE6',
  },
  dark: {
    bg: '#141110',
    card: '#1D1917',
    txt: '#F6F1EE',
    tx2: '#BBB1AB',
    tx3: '#958A84',
    bd: 'rgba(246,241,238,.09)',
    bd2: 'rgba(246,241,238,.22)',
    soft: '#29231F',
  },
};

export type StatusToneKey = 'wait' | 'fix' | 'ok' | 'sched' | 'prod' | 'done';

// Fixed set, never derived from the accent (spec table "Status").
export const PAUTA_STATUS: Record<
  'light' | 'dark',
  Record<StatusToneKey, { fg: string; bg: string }>
> = {
  light: {
    wait: { fg: '#8A5300', bg: 'rgba(214,138,0,.14)' },
    fix: { fg: '#B42318', bg: 'rgba(180,35,24,.09)' },
    ok: { fg: '#146C46', bg: 'rgba(20,108,70,.10)' },
    sched: { fg: '#1F4FB0', bg: 'rgba(31,79,176,.10)' },
    prod: { fg: '#6D3FC4', bg: 'rgba(109,63,196,.10)' },
    done: { fg: 'var(--hub-tx2)', bg: 'var(--hub-soft)' },
  },
  dark: {
    wait: { fg: '#F2B65A', bg: 'rgba(242,182,90,.14)' },
    fix: { fg: '#FF8F85', bg: 'rgba(255,143,133,.13)' },
    ok: { fg: '#5BD69B', bg: 'rgba(91,214,155,.13)' },
    sched: { fg: '#93B4FF', bg: 'rgba(147,180,255,.14)' },
    prod: { fg: '#C3A6FF', bg: 'rgba(195,166,255,.14)' },
    done: { fg: 'var(--hub-tx2)', bg: 'var(--hub-soft)' },
  },
};

const RADIUS_CHIP: Record<HubRadius, string> = { square: '3px', soft: '8px', pill: '999px' };
const RADIUS_TILE: Record<HubRadius, string> = { square: '0px', soft: '8px', pill: '14px' };
const RADIUS_DOT: Record<HubRadius, string> = { square: '0px', soft: '2px', pill: '999px' };

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
  'bricolage-grotesque': {
    label: 'Bricolage Grotesque',
    css: "'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif",
    gf: 'Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700',
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
  figtree: {
    label: 'Figtree',
    css: "'Figtree', ui-sans-serif, system-ui, sans-serif",
    gf: 'Figtree:wght@400;500;600;700',
  },
};

export const HUB_FONT_PAIRINGS: { display: string; body: string; label: string }[] = [
  { display: 'bricolage-grotesque', body: 'figtree', label: 'Assinatura' },
  { display: 'fraunces', body: 'instrument-sans', label: 'Editorial' },
  { display: 'playfair-display', body: 'inter', label: 'Clássico' },
  { display: 'space-grotesk', body: 'inter', label: 'Moderno' },
  { display: 'lora', body: 'public-sans', label: 'Sóbrio' },
];

const DEFAULT_DISPLAY_ID = 'fraunces';
const DEFAULT_BODY_ID = 'instrument-sans';

export const PAUTA_FONTS = { display: 'bricolage-grotesque', body: 'figtree' } as const;
const PAUTA_ONLY_FONT_IDS = new Set<string>([PAUTA_FONTS.display, PAUTA_FONTS.body]);

/** The font ids a hub actually uses. One function for the resolver and for both
 * font loaders (HubShell's <link id="hub-custom-fonts"> and the CRM HubPreview). */
export function effectiveHubFonts(
  look: HubLook,
  customized: boolean,
  stored: { display?: string | null; body?: string | null },
): { display: string; body: string } {
  if (customized) {
    return { display: stored.display ?? DEFAULT_DISPLAY_ID, body: stored.body ?? DEFAULT_BODY_ID };
  }
  return look === 'pauta'
    ? { display: PAUTA_FONTS.display, body: PAUTA_FONTS.body }
    : { display: DEFAULT_DISPLAY_ID, body: DEFAULT_BODY_ID };
}

/** Font choices offered in the CRM HubTab. Without the flag the Assinatura ids
 * and pair are hidden, except the ones the workspace already stored. */
export function hubFontOptions(pauta: boolean, current: { display: string; body: string }) {
  const keep = (id: string) =>
    pauta || !PAUTA_ONLY_FONT_IDS.has(id) || id === current.display || id === current.body;
  return {
    display: Object.entries(HUB_DISPLAY_FONTS).filter(([id]) => keep(id)),
    body: Object.entries(HUB_BODY_FONTS).filter(([id]) => keep(id)),
    pairings: HUB_FONT_PAIRINGS.filter(
      (p) =>
        pauta ||
        p.display !== PAUTA_FONTS.display ||
        (current.display === p.display && current.body === p.body),
    ),
  };
}

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

export function resolveHubTheme(
  config: HubThemeConfig,
  dark: boolean,
  look: HubLook = 'classic',
): ResolvedHubTheme {
  const pauta = look === 'pauta';
  const family =
    pauta && config.surface === 'warm'
      ? PAUTA_WARM
      : (PALETTES[config.surface] ?? PALETTES.neutral);
  const t = dark ? family.dark : family.light;

  // Accent clamp pipeline: unchanged from the pre-customization resolver. --hub-acc /
  // --hub-acc-fg keep this behavior regardless of `customized` and of `look`.
  let acc = config.accent && HEX_RE.test(config.accent) ? config.accent : '#171717';
  const lum = relativeLuminance(acc);
  if (dark && lum < 0.18) acc = '#F5F5F5';
  else if (!dark && lum > 0.85) acc = '#171717';
  const accFg = relativeLuminance(acc) > 0.55 ? '#171717' : '#ffffff';

  let primary: string;
  let primaryFg: string;
  let ring: string;
  if (pauta) {
    const readable = readablePrimary(acc);
    primary = readable.primary;
    primaryFg = readable.fg;
    ring = `color-mix(in srgb, ${acc} 22%, transparent)`;
  } else {
    primary = config.customized ? acc : 'var(--hub-txt)';
    primaryFg = config.customized ? accFg : 'var(--hub-card)';
    ring = config.customized
      ? `color-mix(in srgb, ${acc} 22%, transparent)`
      : 'color-mix(in srgb, var(--hub-txt) 15%, transparent)';
  }

  const radius: HubRadius = config.radius in RADIUS_CARD ? config.radius : 'soft';
  const cardStyle: HubCardStyle = config.cardStyle in CARD_BG ? config.cardStyle : 'filled';

  // Classic keeps reading config.fontDisplay/fontBody as before (callers already pass
  // defaults when not customized); Pauta goes through effectiveHubFonts.
  const fontIds = pauta
    ? effectiveHubFonts(look, config.customized, {
        display: config.fontDisplay,
        body: config.fontBody,
      })
    : { display: config.fontDisplay, body: config.fontBody };
  const fontDisplay = HUB_DISPLAY_FONTS[fontIds.display] ?? HUB_DISPLAY_FONTS[DEFAULT_DISPLAY_ID];
  const fontBody = HUB_BODY_FONTS[fontIds.body] ?? HUB_BODY_FONTS[DEFAULT_BODY_ID];
  const displayIsFraunces =
    !(fontIds.display in HUB_DISPLAY_FONTS) || fontIds.display === 'fraunces';

  const status = PAUTA_STATUS[dark ? 'dark' : 'light'];
  const statusVars: Record<string, string> = {};
  for (const [tone, { fg, bg }] of Object.entries(status)) {
    statusVars[`--hub-st-${tone}-fg`] = fg;
    statusVars[`--hub-st-${tone}-bg`] = bg;
  }

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
      '--hub-r-card': RADIUS_CARD[radius],
      '--hub-r-ctl': RADIUS_CTL[radius],
      '--hub-card-bg': CARD_BG[cardStyle],
      '--hub-card-bd': CARD_BD[cardStyle],
      // New in Pauta. Emitted in both looks; only Pauta rules and branches read them.
      '--hub-acc-soft': `color-mix(in srgb, ${acc} 16%, transparent)`,
      '--hub-display-weight': displayIsFraunces ? '500' : '600',
      '--hub-shadow-card':
        cardStyle === 'filled' && !dark ? '0 1px 2px rgba(16,16,16,.05)' : 'none',
      '--hub-r-chip': RADIUS_CHIP[radius],
      '--hub-r-tile': RADIUS_TILE[radius],
      '--hub-r-dot': RADIUS_DOT[radius],
      ...statusVars,
    },
  };
}
