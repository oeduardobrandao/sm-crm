// T3.6 BrandPanel (docs/estudio-design.md §6.1 Dock/, plan §4). The dock's "Marca" panel:
// the client's brand kit, one click from the canvas.
//  - Cores: the hub_brand hexes as swatches — click applies to the selected layer (text color /
//    shape fill; the caller owns that mapping).
//  - Fontes: raw brand font names resolved through the shared matcher; matched → "Aplicar" to
//    the selected text layer, unmatched → "não incluída no Estúdio" (never a guess).
//  - Logo: materialized (logo_file_id) → thumbnail + "Inserir logo" (fit:'contain' image
//    layer); only a logo_url → "Importar logo" (the T3.2 SSRF-hardened server import, then
//    invalidate the shared hub-brand query); neither → empty state.
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { findFamily } from '../../hooks/useFontManifest';
import { useFileUrl } from '../../hooks/useImageUrls';
import { importBrandLogo } from '../../hooks/usePostDesignQuery';
import type { PostBrand } from '../../hooks/usePostBrand';

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
};

const hintStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--text-muted)',
};

const actionButtonStyle: React.CSSProperties = {
  padding: '0.35rem 0.7rem',
  borderRadius: 8,
  border: '1px solid var(--border-color)',
  background: 'var(--surface-main)',
  color: 'var(--text-main)',
  fontSize: '0.75rem',
  fontWeight: 600,
  cursor: 'pointer',
};

/** Maps the /brand-logo `reason` codes to user-facing PT copy — grouped, because the user's
 * remedy is the same within each group (fix the URL, shrink the image, free up storage, …). */
export function importLogoReasonKey(reason: string): string {
  switch (reason) {
    case 'no_logo_url':
      return 'brandPanel.importReason.noLogoUrl';
    case 'invalid_url':
    case 'not_https':
      return 'brandPanel.importReason.invalidUrl';
    case 'ip_literal_host':
    case 'private_address':
    case 'redirect_rejected':
      return 'brandPanel.importReason.blocked';
    case 'dns_resolution_failed':
    case 'fetch_failed':
    case 'timeout':
      return 'brandPanel.importReason.unreachable';
    case 'not_an_image':
      return 'brandPanel.importReason.notImage';
    case 'too_large':
      return 'brandPanel.importReason.tooLarge';
    case 'quota_exceeded':
      return 'brandPanel.importReason.quota';
    default:
      return 'brandPanel.importReason.generic';
  }
}

export interface BrandPanelProps {
  brand: PostBrand;
  /** Type of the currently-selected layer — gates which "apply" actions make sense. */
  selectedLayerType: 'text' | 'image' | 'shape' | null;
  /** Applies a brand hex to the selected layer (text color / shape fill — caller's mapping). */
  onApplyColor: (hex: string) => void;
  /** Applies a matched brand font family to the selected text layer. */
  onApplyFont: (familyKey: string) => void;
  /** Inserts the materialized logo as a fit:'contain' image layer; `natural` carries the
   * thumbnail <img>'s decoded dimensions when available (files.width/height can be null). */
  onInsertLogo: (fileId: number, natural: { width: number; height: number } | null) => void;
}

export function BrandPanel({
  brand,
  selectedLayerType,
  onApplyColor,
  onApplyFont,
  onInsertLogo,
}: BrandPanelProps) {
  const { t } = useTranslation('estudio');
  const queryClient = useQueryClient();
  const logoUrlQuery = useFileUrl(brand.logoFileId);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const [importing, setImporting] = useState(false);

  const importMutation = useMutation({
    mutationFn: () => importBrandLogo(brand.clienteId!),
    onMutate: () => setImporting(true),
    onSettled: () => setImporting(false),
    onSuccess: (result) => {
      if (result.logo_file_id !== null) {
        toast.success(t('brandPanel.importSuccess'));
        void queryClient.invalidateQueries({ queryKey: ['hub-brand-crm', brand.clienteId] });
      } else {
        toast.error(t(importLogoReasonKey(result.reason ?? '')));
      }
    },
    onError: () => toast.error(t('brandPanel.importReason.generic')),
  });

  if (!brand.brand) {
    return (
      <div data-testid="estudio-brand-panel" style={{ width: 240 }}>
        <p style={hintStyle}>{t('brandPanel.noBrand')}</p>
      </div>
    );
  }

  const colorTargetSelected = selectedLayerType === 'text' || selectedLayerType === 'shape';
  const fontTargetSelected = selectedLayerType === 'text';

  return (
    <div
      data-testid="estudio-brand-panel"
      style={{ width: 260, display: 'flex', flexDirection: 'column', gap: '0.9rem' }}
    >
      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <span style={sectionLabelStyle}>{t('brandPanel.colors')}</span>
        {brand.brandColors.length === 0 ? (
          <p style={hintStyle}>{t('brandPanel.noColors')}</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {brand.brandColors.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  aria-label={hex}
                  disabled={!colorTargetSelected}
                  onClick={() => onApplyColor(hex)}
                  data-testid="estudio-brand-color"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    border: '1px solid var(--border-color)',
                    background: hex,
                    cursor: colorTargetSelected ? 'pointer' : 'default',
                    opacity: colorTargetSelected ? 1 : 0.45,
                    padding: 0,
                  }}
                />
              ))}
            </div>
            {!colorTargetSelected && <p style={hintStyle}>{t('brandPanel.selectColorTarget')}</p>}
          </>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <span style={sectionLabelStyle}>{t('brandPanel.fonts')}</span>
        {brand.brandFonts.length === 0 ? (
          <p style={hintStyle}>{t('brandPanel.noFonts')}</p>
        ) : (
          brand.brandFonts.map((entry) => {
            const family = entry.key ? findFamily(entry.key) : undefined;
            return (
              <div
                key={entry.raw}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                data-testid="estudio-brand-font"
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {family?.name ?? entry.raw}
                  </div>
                  {!family && <div style={hintStyle}>{t('fontPicker.notIncluded')}</div>}
                </div>
                {family && (
                  <button
                    type="button"
                    style={{
                      ...actionButtonStyle,
                      cursor: fontTargetSelected ? 'pointer' : 'default',
                      opacity: fontTargetSelected ? 1 : 0.45,
                    }}
                    disabled={!fontTargetSelected}
                    title={fontTargetSelected ? undefined : t('brandPanel.selectFontTarget')}
                    onClick={() => onApplyFont(family.key)}
                  >
                    {t('brandPanel.apply')}
                  </button>
                )}
              </div>
            );
          })
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <span style={sectionLabelStyle}>{t('brandPanel.logo')}</span>
        {brand.logoFileId !== null ? (
          <>
            {logoUrlQuery.data && (
              <img
                ref={logoImgRef}
                src={logoUrlQuery.data}
                alt={t('brandPanel.logo')}
                style={{
                  maxWidth: '100%',
                  maxHeight: 72,
                  objectFit: 'contain',
                  alignSelf: 'flex-start',
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  padding: 4,
                }}
              />
            )}
            <button
              type="button"
              style={actionButtonStyle}
              data-testid="estudio-brand-insert-logo"
              onClick={() => {
                const img = logoImgRef.current;
                const natural =
                  img && img.naturalWidth > 0 && img.naturalHeight > 0
                    ? { width: img.naturalWidth, height: img.naturalHeight }
                    : null;
                onInsertLogo(brand.logoFileId!, natural);
              }}
            >
              {t('brandPanel.insertLogo')}
            </button>
          </>
        ) : brand.logoUrl ? (
          <button
            type="button"
            style={{ ...actionButtonStyle, display: 'flex', alignItems: 'center', gap: 6 }}
            disabled={importing}
            data-testid="estudio-brand-import-logo"
            onClick={() => importMutation.mutate()}
          >
            {importing && <Loader2 size={13} className="animate-spin" />}
            {importing ? t('brandPanel.importing') : t('brandPanel.importLogo')}
          </button>
        ) : (
          <p style={hintStyle}>{t('brandPanel.noLogo')}</p>
        )}
      </section>
    </div>
  );
}
