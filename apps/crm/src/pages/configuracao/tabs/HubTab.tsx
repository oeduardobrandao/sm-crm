import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
// Same cross-boundary reach as HubPreview.tsx (see its header comment): the
// surface swatches need the resolver's REAL light-mode palette so they never
// drift from what the Hub actually renders.
import {
  PALETTES,
  HUB_FONT_PAIRINGS,
  type HubSurface,
  type HubRadius,
  type HubCardStyle,
} from '../../../../../hub/src/theme';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

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
const RADIUS_OPTIONS: { value: HubRadius; label: string }[] = [
  { value: 'square', label: 'Reto' },
  { value: 'soft', label: 'Suave' },
  { value: 'pill', label: 'Pílula' },
];
const CARD_STYLE_OPTIONS: { value: HubCardStyle; label: string }[] = [
  { value: 'filled', label: 'Preenchido' },
  { value: 'outline', label: 'Contorno' },
  { value: 'tonal', label: 'Tonal' },
];
const LOGO_STYLE_OPTIONS = [
  { value: 'round', label: 'Redondo' },
  { value: 'wordmark', label: 'Horizontal' },
];
const APPEARANCE_OPTIONS = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
];

/** Segmented single-choice control, sharing one look across every "pick one of N" field
 * on this tab (cantos, estilo de cards, logo, aparência padrão). */
function SegmentedControl({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
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
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function SurfaceSwatches({
  value,
  onChange,
  disabled,
}: {
  value: HubSurface;
  onChange: (value: HubSurface) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
      {SURFACE_OPTIONS.map((opt) => {
        const palette = PALETTES[opt.value].light;
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            aria-label={opt.label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              padding: '0.5rem',
              borderRadius: 10,
              border: active ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
              background: 'var(--surface-main)',
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              width: 84,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'block',
                width: '100%',
                height: 36,
                borderRadius: 6,
                background: palette.bg,
                border: `1px solid ${palette.bd}`,
                position: 'relative',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  inset: '8px 8px 4px 8px',
                  borderRadius: 4,
                  background: palette.card,
                  border: `1px solid ${palette.bd}`,
                }}
              />
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-main)' }}>{opt.label}</span>
          </button>
        );
      })}
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

  const handleLogoDarkUpload = async (file: File) => {
    if (!workspace) return;
    if (file.size > MAX_LOGO_BYTES) {
      toast.error('Arquivo deve ser menor que 2MB.');
      return;
    }
    setLogoUploading(true);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const size = Math.min(bitmap.width, bitmap.height, 512);
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, size, size);
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

  return (
    <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
      <h3 className="config-title">Personalizar Hub</h3>
      <p style={{ ...HINT, marginTop: 0, marginBottom: '1.5rem' }}>
        A aparência do portal que seus clientes usam para aprovar posts e acompanhar entregas.
      </p>

      <div className="config-hub-grid">
        <div>
          {/* Brand colour: ungated, drives the Hub calendar accent and the report accent
              regardless of plan. */}
          <div style={FIELD}>
            <Label style={FIELD_LABEL}>Cor da marca</Label>
            <ColorPicker
              value={brandColor}
              onChange={(hex) => setBrandColor(hex)}
              label="Cor da marca"
              disabled={brandingPending || brandingFailed}
            />
            <p style={HINT}>
              A mesma cor do relatório mensal. Marca o calendário do Hub e os destaques do
              relatório.
            </p>
          </div>

          <FeatureGate flag="feature_brand_customization" label="Personalização do Hub">
            <div style={FIELD}>
              <Label style={FIELD_LABEL}>Tema de superfície</Label>
              <SurfaceSwatches
                value={surface}
                onChange={setSurface}
                disabled={brandingPending || brandingFailed}
              />
            </div>

            <div style={FIELD}>
              <Label style={FIELD_LABEL}>Cantos</Label>
              <SegmentedControl
                value={radius}
                onChange={(v) => setRadius(v as HubRadius)}
                options={RADIUS_OPTIONS}
                ariaLabel="Cantos"
                disabled={brandingPending || brandingFailed}
              />
            </div>

            <div style={FIELD}>
              <Label style={FIELD_LABEL}>Estilo de cards</Label>
              <SegmentedControl
                value={cardStyle}
                onChange={(v) => setCardStyle(v as HubCardStyle)}
                options={CARD_STYLE_OPTIONS}
                ariaLabel="Estilo de cards"
                disabled={brandingPending || brandingFailed}
              />
            </div>

            <div style={FIELD}>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 160px' }}>
                  <Label htmlFor="hub-font-display" style={FIELD_LABEL}>
                    Fonte de títulos
                  </Label>
                  <Select value={fontDisplay} onValueChange={setFontDisplay}>
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
                  <Select value={fontBody} onValueChange={setFontBody}>
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
              <p style={{ ...HINT, marginBottom: '0.5rem' }}>Combinações sugeridas</p>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {HUB_FONT_PAIRINGS.map((pairing) => (
                  <button
                    key={pairing.label}
                    type="button"
                    onClick={() => {
                      setFontDisplay(pairing.display);
                      setFontBody(pairing.body);
                    }}
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.3rem 0.65rem',
                      borderRadius: 999,
                      border: '1px solid var(--border-color)',
                      background:
                        fontDisplay === pairing.display && fontBody === pairing.body
                          ? 'var(--surface-1)'
                          : 'transparent',
                      color: 'var(--text-main)',
                      cursor: 'pointer',
                    }}
                  >
                    {pairing.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={FIELD}>
              <Label style={FIELD_LABEL}>Logo no hub</Label>
              <SegmentedControl
                value={logoStyle}
                onChange={setLogoStyle}
                options={LOGO_STYLE_OPTIONS}
                ariaLabel="Logo no hub"
                disabled={brandingPending || brandingFailed}
              />

              <div style={{ marginTop: '1rem' }}>
                <Label htmlFor="hub-logo-dark-trigger" style={FIELD_LABEL}>
                  Logo para modo escuro
                </Label>
                <div
                  style={{
                    display: 'flex',
                    gap: '0.75rem',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
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
                  <Button
                    id="hub-logo-dark-trigger"
                    variant="outline"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={logoUploading}
                  >
                    {logoUploading && <Spinner size="sm" />}
                    {logoUploading ? 'Enviando…' : logoDarkUrl ? 'Trocar logo' : 'Enviar logo'}
                  </Button>
                  {logoDarkUrl && (
                    <Button
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setRemoveLogoOpen(true)}
                      disabled={logoUploading}
                    >
                      Remover
                    </Button>
                  )}
                </div>
                <p style={HINT}>
                  PNG, JPG ou WebP. Máx 2MB. Usada no lugar da logo principal quando o cliente está
                  no modo escuro.
                </p>
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
            </div>

            <div style={FIELD}>
              <Label style={FIELD_LABEL}>Aparência padrão</Label>
              <SegmentedControl
                value={defaultAppearance}
                onChange={setDefaultAppearance}
                options={APPEARANCE_OPTIONS}
                ariaLabel="Aparência padrão"
                disabled={brandingPending || brandingFailed}
              />
              <p style={HINT}>O cliente ainda pode alternar no hub.</p>
            </div>

            <div style={{ ...FIELD, display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
              <Switch
                id="hub-hide-branding"
                checked={hideBranding}
                disabled={brandingPending || brandingFailed}
                onCheckedChange={setHideBranding}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <div>
                <Label htmlFor="hub-hide-branding" style={{ fontWeight: 500, cursor: 'pointer' }}>
                  Ocultar &quot;powered by mesaas&quot;
                </Label>
              </div>
            </div>
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
            disabled={saveMutation.isPending || brandingPending || brandingFailed}
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
