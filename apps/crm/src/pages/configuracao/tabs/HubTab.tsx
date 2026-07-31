import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Palette,
  Droplet,
  Type as TypeIcon,
  LayoutGrid,
  IdCard,
  Sun,
  Moon,
  Upload,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ColorPicker } from '@/components/shared/ColorPicker';
import { FeatureGate } from '@/components/paywall/FeatureGate';
import { useAuth } from '../../../context/AuthContext';
import { useEntitlements } from '../../../hooks/useEntitlements';
import { supabase } from '../../../lib/supabase';
import {
  getCurrentWorkspace,
  getHubBranding,
  updateHubBranding,
  type HubBranding,
} from '../../../store';
import { HubPreview, HUB_DISPLAY_FONTS, HUB_BODY_FONTS, type HubPreviewDraft } from '../HubPreview';
// Same cross-boundary reach as HubPreview.tsx (see its header comment): controls
// need the resolver's REAL palette/accent math so they never drift from what the
// Hub actually renders.
import {
  PALETTES,
  HUB_FONT_PAIRINGS,
  resolveHubTheme,
  relativeLuminance,
  type HubSurface,
  type HubRadius,
  type HubCardStyle,
} from '../../../../../hub/src/theme';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const HEX_6_RE = /^#[0-9a-fA-F]{6}$/;

const HINT: CSSProperties = {
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--text-muted)',
  marginTop: '0.5rem',
  maxWidth: '52ch',
};
const FIELD: CSSProperties = { marginBottom: '1.5rem' };
const FIELD_LABEL: CSSProperties = { display: 'block', marginBottom: '0.5rem' };

const SURFACE_OPTIONS: { value: HubSurface; label: string }[] = [
  { value: 'neutral', label: 'Neutro' },
  { value: 'warm', label: 'Quente' },
  { value: 'cool', label: 'Frio' },
];
// Suave leads: it's hub_radius's default (migration 20260731000001), so it's what
// most workspaces already have — putting it first matches what they'll see.
const RADIUS_OPTIONS: { value: HubRadius; label: string }[] = [
  { value: 'soft', label: 'Suave' },
  { value: 'square', label: 'Reto' },
  { value: 'pill', label: 'Pílula' },
];
const CARD_STYLE_OPTIONS: { value: HubCardStyle; label: string }[] = [
  { value: 'filled', label: 'Preenchido' },
  { value: 'outline', label: 'Contorno' },
  { value: 'tonal', label: 'Tonal' },
];
const LOGO_STYLE_OPTIONS: { value: string; label: string; sublabel: string }[] = [
  { value: 'round', label: 'Redondo', sublabel: 'avatar circular' },
  { value: 'wordmark', label: 'Horizontal', sublabel: 'wordmark' },
];
const APPEARANCE_OPTIONS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
];

// Radius values a small (~32px) glyph actually renders at. Mirrors theme.ts's
// RADIUS_CARD/RADIUS_CTL (not exported -- these are display-only, unlike the
// resolver's own live values, which the preview reads through resolveHubTheme).
const RADIUS_GLYPH_PX: Record<HubRadius, number> = { square: 0, soft: 12, pill: 999 };

/** Titled control card: icon + 13-14px title + one-line muted description, then
 * content. Every "Personalizar Hub" section uses this so the tab reads as five
 * scannable groups instead of one long form. */
function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="card animate-up" style={{ marginBottom: '1.25rem' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}
      >
        <Icon size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden="true" />
        <h4 style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-main)', margin: 0 }}>
          {title}
        </h4>
      </div>
      <p style={{ ...HINT, marginTop: 0, marginBottom: '1.25rem' }}>{description}</p>
      {children}
    </div>
  );
}

/** Segmented single-choice control (optionally with a leading icon per option). Used
 * where the choice is binary/simple text, not a visual pick -- see OptionCardGroup
 * for the "show me what it looks like" controls. */
function SegmentedControl({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; icon?: LucideIcon }[];
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      // Radix ToggleGroup (type="single") fires an empty string when the active
      // item is clicked again — ignore it, a segmented control always keeps one
      // value selected, it never goes empty.
      onValueChange={(next) => next && onChange(next)}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      {options.map((opt) => (
        <ToggleGroupItem key={opt.value} value={opt.value} aria-label={opt.label}>
          {opt.icon && <opt.icon size={13} aria-hidden="true" />}
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function optionCardStyle(active: boolean, disabled?: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.6rem',
    borderRadius: 10,
    border: active ? '1px solid transparent' : '1px solid var(--border-color)',
    boxShadow: active ? '0 0 0 1px var(--card-bg), 0 0 0 3px var(--primary-color)' : 'none',
    background: 'var(--surface-main)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    minWidth: 88,
    textAlign: 'center',
  };
}

interface OptionCardSpec<V extends string> {
  value: V;
  label: string;
  sublabel?: string;
  glyph: ReactNode;
}

/** A row of "show me what it looks like" picks: a live glyph, a label, and an
 * optional sublabel, sharing one look across surface theme, cantos, estilo de
 * cards and logo. Replaces plain text radios with something the agency can
 * actually judge visually before saving. */
function OptionCardGroup<V extends string>({
  value,
  onChange,
  options,
  disabled,
  groupLabel,
}: {
  value: V;
  onChange: (value: V) => void;
  options: OptionCardSpec<V>[];
  disabled?: boolean;
  groupLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={groupLabel}
      style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            style={optionCardStyle(active, disabled)}
          >
            {opt.glyph}
            <span style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--text-main)' }}>
              {opt.label}
            </span>
            {opt.sublabel && (
              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                {opt.sublabel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Mini-page swatch: a tiny "page" tinted with the surface palette, holding a card
 * rect and two text-stroke bars, so a theme reads as a miniature screen instead of
 * a colour dot. */
function SurfaceGlyph({ surface }: { surface: HubSurface }) {
  const palette = PALETTES[surface].light;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: 64,
        height: 44,
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

function RadiusGlyph({ radius }: { radius: HubRadius }) {
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

function CardStyleGlyph({ cardStyle }: { cardStyle: HubCardStyle }) {
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
function LogoGlyph({
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

function FontPairingCards({
  fontDisplay,
  fontBody,
  onPick,
  disabled,
}: {
  fontDisplay: string;
  fontBody: string;
  onPick: (display: string, body: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Combinações de fontes sugeridas"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
        gap: '0.6rem',
        marginBottom: '1rem',
      }}
    >
      {HUB_FONT_PAIRINGS.map((pairing) => {
        const active = fontDisplay === pairing.display && fontBody === pairing.body;
        const displayFont = HUB_DISPLAY_FONTS[pairing.display];
        const bodyFont = HUB_BODY_FONTS[pairing.body];
        return (
          <button
            key={pairing.label}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onPick(pairing.display, pairing.body)}
            style={optionCardStyle(active, disabled)}
          >
            <span
              aria-hidden="true"
              style={{
                fontFamily: displayFont?.css,
                fontSize: '1.7rem',
                lineHeight: 1,
                color: 'var(--text-main)',
              }}
            >
              Ag
            </span>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-main)' }}>
              {pairing.label}
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
              {displayFont?.label} · {bodyFont?.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Collapsed by default: the pairing cards above cover the common case, this is the
 * escape hatch for mixing display/body fonts freely. Same aria-expanded/chevron
 * pattern as the landing page's FaqSection, this codebase's existing disclosure. */
function FontSelectsDisclosure({
  fontDisplay,
  setFontDisplay,
  fontBody,
  setFontBody,
  disabled,
}: {
  fontDisplay: string;
  setFontDisplay: (v: string) => void;
  fontBody: string;
  setFontBody: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="hub-font-selects-panel"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
          fontSize: '0.78rem',
          color: 'var(--text-muted)',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
        }}
      >
        <ChevronDown
          size={14}
          aria-hidden="true"
          style={{
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 150ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
        Escolher fontes separadamente
      </button>
      {open && (
        <div
          id="hub-font-selects-panel"
          style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.75rem' }}
        >
          <div style={{ flex: '1 1 160px' }}>
            <Label htmlFor="hub-font-display" style={FIELD_LABEL}>
              Fonte de títulos
            </Label>
            <Select value={fontDisplay} onValueChange={setFontDisplay} disabled={disabled}>
              <SelectTrigger id="hub-font-display">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(HUB_DISPLAY_FONTS).map(([id, font]) => (
                  <SelectItem key={id} value={id} style={{ fontFamily: font.css }}>
                    {font.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <Label htmlFor="hub-font-body" style={FIELD_LABEL}>
              Fonte de texto
            </Label>
            <Select value={fontBody} onValueChange={setFontBody} disabled={disabled}>
              <SelectTrigger id="hub-font-body">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(HUB_BODY_FONTS).map(([id, font]) => (
                  <SelectItem key={id} value={id} style={{ fontFamily: font.css }}>
                    {font.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
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
function AccentChips({ brandColor }: { brandColor: string }) {
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

/** Branding for the client-facing Hub (Configurações → Hub), with a live preview. */
export default function HubTab() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';
  const { hasFeature, isLoading: entitlementsLoading } = useEntitlements();
  const customized = !entitlementsLoading && hasFeature('feature_brand_customization');

  const { data: workspace } = useQuery({
    queryKey: ['currentWorkspace'],
    queryFn: getCurrentWorkspace,
    enabled: isOwnerOrAdmin,
  });

  const {
    data: branding,
    isPending: brandingPending,
    isError: brandingFailed,
  } = useQuery({
    queryKey: ['workspace-hub-branding'],
    queryFn: getHubBranding,
    enabled: isOwnerOrAdmin,
  });

  const [brandColor, setBrandColor] = useState('#eab308');
  const [surface, setSurface] = useState<HubSurface>('neutral');
  const [radius, setRadius] = useState<HubRadius>('soft');
  const [cardStyle, setCardStyle] = useState<HubCardStyle>('filled');
  const [fontDisplay, setFontDisplay] = useState('fraunces');
  const [fontBody, setFontBody] = useState('instrument-sans');
  const [logoStyle, setLogoStyle] = useState('round');
  const [defaultAppearance, setDefaultAppearance] = useState('light');
  const [hideBranding, setHideBranding] = useState(false);
  const [logoDarkUrl, setLogoDarkUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [removeLogoOpen, setRemoveLogoOpen] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);
  const controlsDisabled = brandingPending || brandingFailed;

  useEffect(() => {
    if (branding) {
      // Seed the form only once: a refetch (triggered by the dark-logo upload's own
      // save, or by Salvar's invalidation) must not clobber an in-flight, unsaved
      // edit to the other fields. Mirrors RelatoriosTab's brandingInitializedRef.
      if (!initializedRef.current) {
        setBrandColor(branding.brand_color ?? '#eab308');
        setSurface((branding.hub_surface_theme as HubSurface) ?? 'neutral');
        setRadius((branding.hub_radius as HubRadius) ?? 'soft');
        setCardStyle((branding.hub_card_style as HubCardStyle) ?? 'filled');
        setFontDisplay(branding.hub_font_display ?? 'fraunces');
        setFontBody(branding.hub_font_body ?? 'instrument-sans');
        setLogoStyle(branding.hub_logo_style ?? 'round');
        setDefaultAppearance(branding.hub_default_appearance ?? 'light');
        setHideBranding(branding.hub_hide_branding ?? false);
        initializedRef.current = true;
      }
      // The dark logo has no "Salvar" step of its own (saves immediately on
      // upload/remove, like the report splash art), so it always tracks the
      // server value instead of being gated behind initializedRef.
      setLogoDarkUrl(branding.hub_logo_dark_url ?? null);
    }
  }, [branding]);

  // A single, tab-level Google Fonts <link> for the Tipografia pairing-card
  // specimens (limited weights, since these are just "Ag" samples, not real body
  // text). Independent of HubPreview's own font <link>, which loads only the
  // CURRENTLY picked pair for the preview itself -- this one loads every allowlisted
  // display face once, so all four pairing cards render in their real fonts
  // regardless of which pair is selected.
  useEffect(() => {
    const linkId = 'crm-hub-specimen-fonts';
    if (document.getElementById(linkId)) return;
    const families = Object.values(HUB_DISPLAY_FONTS).map(
      (font) => `family=${font.gf.split(':')[0]}:wght@500;600`,
    );
    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
    document.head.appendChild(link);
    return () => {
      document.getElementById(linkId)?.remove();
    };
  }, []);

  const handleLogoDarkUpload = async (file: File) => {
    if (!workspace) return;
    if (file.size > MAX_LOGO_BYTES) {
      toast.error('Arquivo deve ser menor que 2MB.');
      return;
    }
    setLogoUploading(true);
    try {
      const bitmap = await createImageBitmap(file);
      // Bound the longest side at 512px, keeping the source aspect ratio: this
      // logo can be a 'wordmark' (Horizontal logo style), which is exactly the
      // shape a forced-square canvas would stretch. WorkspaceTab's logo upload
      // deliberately squares its canvas for a circular avatar crop, but that
      // doesn't apply here.
      const MAX_DIM = 512;
      const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));

      const path = `workspaces/${workspace.id}/logo-dark.png`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/png' });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = urlData.publicUrl + '?t=' + Date.now();
      await updateHubBranding({ hub_logo_dark_url: publicUrl });
      setLogoDarkUrl(publicUrl);
      queryClient.setQueryData(['workspace-hub-branding'], (old: HubBranding | undefined) =>
        old ? { ...old, hub_logo_dark_url: publicUrl } : old,
      );
      toast.success('Logo para modo escuro atualizada.');
    } catch (err: unknown) {
      console.error('hub dark logo upload failed', err);
      toast.error('Não foi possível enviar a logo. Tente novamente.');
    } finally {
      setLogoUploading(false);
    }
  };

  const handleRemoveLogoDark = async () => {
    if (!workspace) return;
    setLogoUploading(true);
    try {
      await updateHubBranding({ hub_logo_dark_url: null });
      setLogoDarkUrl(null);
      queryClient.setQueryData(['workspace-hub-branding'], (old: HubBranding | undefined) =>
        old ? { ...old, hub_logo_dark_url: null } : old,
      );
      toast.success('Logo para modo escuro removida.');
    } catch (err: unknown) {
      console.error('hub dark logo removal failed', err);
      toast.error('Não foi possível remover a logo. Tente novamente.');
    } finally {
      setLogoUploading(false);
      setRemoveLogoOpen(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      updateHubBranding({
        brand_color: brandColor,
        hub_surface_theme: surface,
        hub_radius: radius,
        hub_card_style: cardStyle,
        hub_font_display: fontDisplay,
        hub_font_body: fontBody,
        hub_logo_style: logoStyle,
        hub_default_appearance: defaultAppearance,
        hub_hide_branding: hideBranding,
      }),
    onSuccess: () => {
      // brand_color is shared with the report preview (RelatoriosTab reads it from
      // this same 'workspaces' row via the workspace-branding query), so both
      // caches need to move together or the report tab shows a stale swatch.
      queryClient.invalidateQueries({ queryKey: ['workspace-hub-branding'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-branding'] });
      toast.success('Hub atualizado!');
    },
    onError: (err: unknown) => {
      console.error('hub branding save failed', err);
      toast.error('Não foi possível salvar. Tente novamente.');
    },
  });

  const previewDraft: HubPreviewDraft = {
    brandColor,
    surface,
    fontDisplay,
    fontBody,
    radius,
    cardStyle,
    logoStyle,
    logoDarkUrl,
    hideBranding,
    defaultAppearance,
  };

  const workspaceInitial = (workspace?.name || '?').trim().charAt(0).toUpperCase() || '?';
  const fontDisplayCss = HUB_DISPLAY_FONTS[fontDisplay]?.css ?? HUB_DISPLAY_FONTS.fraunces.css;

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">Personalizar Hub</h3>
        <p style={{ ...HINT, marginTop: 0 }}>
          A aparência do portal que seus clientes usam para aprovar posts e acompanhar entregas.
        </p>
      </div>

      <div className="config-hub-grid">
        <div>
          <FeatureGate flag="feature_brand_customization" label="Personalização do Hub">
            <SectionCard
              icon={Palette}
              title="Aparência"
              description="O clima geral do hub. O cliente ainda pode alternar claro e escuro."
            >
              <div style={FIELD}>
                <Label style={FIELD_LABEL}>Tema de superfície</Label>
                <OptionCardGroup
                  groupLabel="Tema de superfície"
                  value={surface}
                  onChange={setSurface}
                  disabled={controlsDisabled}
                  options={SURFACE_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                    glyph: <SurfaceGlyph surface={opt.value} />,
                  }))}
                />
              </div>
              <div>
                <Label style={FIELD_LABEL}>Aparência padrão</Label>
                <SegmentedControl
                  value={defaultAppearance}
                  onChange={setDefaultAppearance}
                  options={APPEARANCE_OPTIONS}
                  ariaLabel="Aparência padrão"
                  disabled={controlsDisabled}
                />
                <p style={HINT}>O cliente ainda pode alternar no hub.</p>
              </div>
            </SectionCard>
          </FeatureGate>

          {/* Brand colour: ungated, drives the Hub calendar accent and the report accent
              regardless of plan. */}
          <SectionCard
            icon={Droplet}
            title="Cor da marca"
            description="Aplicada a botões, navegação ativa e calendário. Contraste garantido."
          >
            <ColorPicker
              value={brandColor}
              onChange={(hex) => setBrandColor(hex)}
              label="Cor da marca"
              disabled={controlsDisabled}
              // workspaces.brand_color is CHECK'd to 6-digit hex, and resolveHubTheme
              // rejects anything else (falls back to #171717) -- an 8-digit
              // #rrggbbaa pick here would either fail to save or silently be ignored
              // by the hub. ColorPicker defaults allowAlpha to true; opt out.
              allowAlpha={false}
            />
            <AccentChips brandColor={brandColor} />
            <p style={HINT}>
              A mesma cor do relatório mensal. Marca o calendário do Hub e os destaques do
              relatório.
            </p>
          </SectionCard>

          <FeatureGate flag="feature_brand_customization" label="Personalização do Hub">
            <SectionCard
              icon={TypeIcon}
              title="Tipografia"
              description="Comece por uma combinação pronta. Ajuste fino abaixo, se quiser."
            >
              <FontPairingCards
                fontDisplay={fontDisplay}
                fontBody={fontBody}
                disabled={controlsDisabled}
                onPick={(display, body) => {
                  setFontDisplay(display);
                  setFontBody(body);
                }}
              />
              <FontSelectsDisclosure
                fontDisplay={fontDisplay}
                setFontDisplay={setFontDisplay}
                fontBody={fontBody}
                setFontBody={setFontBody}
                disabled={controlsDisabled}
              />
            </SectionCard>

            <SectionCard
              icon={LayoutGrid}
              title="Componentes"
              description="A forma dos cards e controles do hub."
            >
              <div style={FIELD}>
                <Label style={FIELD_LABEL}>Cantos</Label>
                <OptionCardGroup
                  groupLabel="Cantos"
                  value={radius}
                  onChange={setRadius}
                  disabled={controlsDisabled}
                  options={RADIUS_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                    glyph: <RadiusGlyph radius={opt.value} />,
                  }))}
                />
              </div>
              <div>
                <Label style={FIELD_LABEL}>Estilo de cards</Label>
                <OptionCardGroup
                  groupLabel="Estilo de cards"
                  value={cardStyle}
                  onChange={setCardStyle}
                  disabled={controlsDisabled}
                  options={CARD_STYLE_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                    glyph: <CardStyleGlyph cardStyle={opt.value} />,
                  }))}
                />
              </div>
            </SectionCard>

            <SectionCard
              icon={IdCard}
              title="Identidade"
              description="Como a marca da agência aparece dentro do hub."
            >
              <div style={FIELD}>
                <Label style={FIELD_LABEL}>Logo no hub</Label>
                <OptionCardGroup
                  groupLabel="Logo no hub"
                  value={logoStyle}
                  onChange={setLogoStyle}
                  disabled={controlsDisabled}
                  options={LOGO_STYLE_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                    sublabel: opt.sublabel,
                    glyph: (
                      <LogoGlyph
                        kind={opt.value as 'round' | 'wordmark'}
                        brandColor={brandColor}
                        initial={workspaceInitial}
                        workspaceName={workspace?.name ?? ''}
                        fontDisplayCss={fontDisplayCss}
                      />
                    ),
                  }))}
                />
              </div>

              <div style={FIELD}>
                <Label style={FIELD_LABEL}>Logo para modo escuro</Label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {logoDarkUrl && (
                    <img
                      src={logoDarkUrl}
                      alt="Logo para modo escuro"
                      style={{
                        width: 56,
                        height: 56,
                        objectFit: 'contain',
                        borderRadius: 8,
                        border: '1px solid var(--border-color)',
                        background: '#12151a',
                        padding: 4,
                        opacity: logoUploading ? 0.5 : 1,
                      }}
                    />
                  )}
                  <button
                    type="button"
                    id="hub-logo-dark-trigger"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={logoUploading}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      border: '1.5px dashed var(--border-color)',
                      borderRadius: 10,
                      padding: '0.85rem',
                      background: 'transparent',
                      cursor: logoUploading ? 'default' : 'pointer',
                      opacity: logoUploading ? 0.6 : 1,
                    }}
                  >
                    {logoUploading ? (
                      <Spinner size="sm" />
                    ) : (
                      <Upload size={15} aria-hidden="true" color="var(--text-muted)" />
                    )}
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
                      {logoUploading
                        ? 'Enviando…'
                        : logoDarkUrl
                          ? 'Trocar logo'
                          : 'Enviar variante clara do logo'}
                    </span>
                  </button>
                  {logoDarkUrl && (
                    <Button
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setRemoveLogoOpen(true)}
                      disabled={logoUploading}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      Remover
                    </Button>
                  )}
                </div>
                <p style={HINT}>PNG · até 2MB. Usada quando o cliente está no modo escuro.</p>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) handleLogoDarkUpload(file);
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <Switch
                  id="hub-hide-branding"
                  checked={hideBranding}
                  disabled={controlsDisabled}
                  onCheckedChange={setHideBranding}
                  style={{ marginTop: 2, flexShrink: 0 }}
                />
                <div>
                  <Label htmlFor="hub-hide-branding" style={{ fontWeight: 500, cursor: 'pointer' }}>
                    Ocultar &quot;powered by mesaas&quot;
                  </Label>
                </div>
              </div>
            </SectionCard>
          </FeatureGate>

          {brandingFailed && (
            <p
              role="alert"
              style={{
                ...HINT,
                color: 'var(--danger-text)',
                marginTop: 0,
                marginBottom: '0.75rem',
              }}
            >
              Não foi possível carregar as configurações do Hub. Recarregue a página. Salvar agora
              sobrescreveria a sua personalização com os valores padrão.
            </p>
          )}

          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || controlsDisabled}
          >
            {saveMutation.isPending && <Spinner size="sm" />} Salvar
          </Button>
        </div>

        {/* Live preview. Configurações → Hub is workspace-level, not per-client, so
            there is no token to build a real "Ver hub" link from here — every hub URL
            is per-client (see pages/cliente-detalhe/HubTab.tsx). We deliberately don't
            invent a tokenless workspace route; the per-client tab is still the place
            to copy/open a client's actual link. */}
        <div>
          <Label style={FIELD_LABEL}>Prévia</Label>
          <HubPreview
            draft={previewDraft}
            workspaceName={workspace?.name ?? ''}
            workspaceLogoUrl={workspace?.logo_url ?? null}
            customized={customized}
          />
        </div>
      </div>

      {/* Remove Dark Logo Confirm */}
      <AlertDialog open={removeLogoOpen} onOpenChange={setRemoveLogoOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover a logo para modo escuro?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveLogoDark} disabled={logoUploading}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
