import type { CSSProperties } from 'react';
import { Sun, Moon, type LucideIcon } from 'lucide-react';
// Same cross-boundary reach as HubPreview.tsx (see its header comment).
import {
  PALETTES,
  resolveHubTheme,
  relativeLuminance,
  type HubSurface,
  type HubRadius,
  type HubCardStyle,
} from '../../../../../../hub/src/theme';

/* Option lists and visual glyphs of Configurações > Hub, shared by the desktop tab
   (HubTab.tsx) and its phone screens (HubPhone.tsx) so both show the same picks. */

export const HEX_6_RE = /^#[0-9a-fA-F]{6}$/;

// The CRM's own tipo palette (postLabels.ts) -- already the canonical
// "Mesaas brand-adjacent" colours per PRODUCT.md, so they double as sensible
// one-click presets here instead of an arbitrary swatch set.
export const BRAND_PRESET_COLORS = ['#eab308', '#E1306C', '#42c8f5', '#3ecf8e'];

export const SURFACE_OPTIONS: { value: HubSurface; label: string }[] = [
  { value: 'neutral', label: 'Neutro' },
  { value: 'warm', label: 'Quente' },
  { value: 'cool', label: 'Frio' },
];
// Suave leads: it's hub_radius's default (migration 20260731000001), so it's what
// most workspaces already have — putting it first matches what they'll see.
export const RADIUS_OPTIONS: { value: HubRadius; label: string }[] = [
  { value: 'soft', label: 'Suave' },
  { value: 'square', label: 'Reto' },
  { value: 'pill', label: 'Pílula' },
];
export const CARD_STYLE_OPTIONS: { value: HubCardStyle; label: string }[] = [
  { value: 'filled', label: 'Preenchido' },
  { value: 'outline', label: 'Contorno' },
  { value: 'tonal', label: 'Tonal' },
];
export const LOGO_STYLE_OPTIONS: { value: string; label: string; sublabel: string }[] = [
  { value: 'round', label: 'Redondo', sublabel: 'avatar circular' },
  { value: 'wordmark', label: 'Horizontal', sublabel: 'wordmark' },
];
export const APPEARANCE_OPTIONS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
];

// Radius values a small (~32px) glyph actually renders at. Mirrors theme.ts's
// RADIUS_CARD/RADIUS_CTL (not exported -- these are display-only, unlike the
// resolver's own live values, which the preview reads through resolveHubTheme).
const RADIUS_GLYPH_PX: Record<HubRadius, number> = { square: 0, soft: 12, pill: 999 };

/** Mini-page swatch: a tiny "page" tinted with the surface palette, holding a card
 * rect and two text-stroke bars, so a theme reads as a miniature screen instead of
 * a colour dot. */
export function SurfaceGlyph({ surface }: { surface: HubSurface }) {
  const palette = PALETTES[surface].light;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: '100%',
        minWidth: 64,
        height: 48,
        borderRadius: 8,
        background: palette.bg,
        border: `1px solid ${palette.bd}`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          position: 'absolute',
          inset: '6px 6px auto 6px',
          height: 18,
          borderRadius: 4,
          background: palette.card,
          border: `1px solid ${palette.bd}`,
        }}
      />
      <span
        style={{
          position: 'absolute',
          left: 9,
          bottom: 6,
          width: '42%',
          height: 2,
          borderRadius: 1,
          background: palette.txt,
          opacity: 0.5,
        }}
      />
      <span
        style={{
          position: 'absolute',
          left: 9,
          bottom: 11,
          width: '28%',
          height: 2,
          borderRadius: 1,
          background: palette.txt,
          opacity: 0.3,
        }}
      />
    </span>
  );
}

export function RadiusGlyph({ radius }: { radius: HubRadius }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: 32,
        height: 32,
        border: '1.5px solid var(--text-muted)',
        borderRadius: RADIUS_GLYPH_PX[radius],
      }}
    />
  );
}

const CARD_STYLE_GLYPH: Record<HubCardStyle, CSSProperties> = {
  filled: { background: 'var(--card-bg)', border: '1px solid var(--border-color)' },
  outline: { background: 'transparent', border: '1.5px solid var(--text-muted)' },
  tonal: { background: 'var(--surface-1)', border: 'none' },
};

export function CardStyleGlyph({ cardStyle }: { cardStyle: HubCardStyle }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: 44,
        height: 32,
        borderRadius: 6,
        ...CARD_STYLE_GLYPH[cardStyle],
      }}
    />
  );
}

/** The round option renders the actual accent-on-avatar fallback (WorkspaceMark's
 * monogram); the wordmark option renders the workspace name in the CURRENTLY
 * picked display font, so Identidade stays honest about the Tipografia choice. */
export function LogoGlyph({
  kind,
  brandColor,
  initial,
  workspaceName,
  fontDisplayCss,
}: {
  kind: 'round' | 'wordmark';
  brandColor: string;
  initial: string;
  workspaceName: string;
  fontDisplayCss: string;
}) {
  if (kind === 'round') {
    const fg =
      HEX_6_RE.test(brandColor) && relativeLuminance(brandColor) > 0.55 ? '#171717' : '#ffffff';
    return (
      <span
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: HEX_6_RE.test(brandColor) ? brandColor : '#171717',
          color: fg,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {initial}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 32,
        fontFamily: fontDisplayCss,
        fontSize: 13,
        color: 'var(--text-main)',
        maxWidth: 92,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {workspaceName || 'Workspace'}
    </span>
  );
}

function accentChipStyle(kind: 'filled' | 'outline'): CSSProperties {
  const base: CSSProperties = {
    fontSize: '0.7rem',
    fontWeight: 600,
    padding: '0.3rem 0.65rem',
    borderRadius: 999,
  };
  if (kind === 'filled')
    return { ...base, background: 'var(--hub-primary)', color: 'var(--hub-primary-fg)' };
  return {
    ...base,
    border: '1px solid var(--hub-acc)',
    color: 'var(--hub-acc)',
    background: 'transparent',
  };
}

/** Shows where the accent actually lands (button, active nav, calendar), resolved
 * through the real theme resolver -- never a hand-picked shade of the hex the user
 * just typed. Surface/font/radius/card style are fixed neutrals here on purpose:
 * this chip row is about the ACCENT, not a full preview (HubPreview already covers
 * that), so it stays correct regardless of what the other sections are set to. */
export function AccentChips({ brandColor }: { brandColor: string }) {
  const vars = resolveHubTheme(
    {
      accent: brandColor,
      surface: 'neutral',
      fontDisplay: 'fraunces',
      fontBody: 'instrument-sans',
      radius: 'soft',
      cardStyle: 'filled',
      customized: true,
    },
    false,
  ).vars as CSSProperties;
  return (
    <div
      style={{ ...vars, display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.85rem' }}
    >
      <span style={accentChipStyle('filled')}>Botão</span>
      <span style={accentChipStyle('outline')}>Nav ativa</span>
      <span style={accentChipStyle('outline')}>Calendário</span>
    </div>
  );
}
