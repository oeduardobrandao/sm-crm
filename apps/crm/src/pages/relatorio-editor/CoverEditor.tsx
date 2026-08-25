// Edição inline da capa no canvas: reproduz a MESMA casca visual do CoverBlock
// (fundo, logo, avatar) e troca kicker/título/subtítulo por inputs. Diferente do
// SectionHeaderEditor (que não reproduz chrome nenhum), a capa precisa do preview
// real porque cor e contraste são o próprio ponto do recurso (spec 2026-08-25).
import type { CSSProperties } from 'react';
import { Minus, Plus } from 'lucide-react';
import { ColorPicker } from '@/components/shared/ColorPicker';
import { CoverAvatar, type CoverConfig } from '@mesaas/report-blocks/blocks/CoverBlock';
import { pickAccentFg } from '@mesaas/report-blocks/theme';
import type { ReportBlock, ReportDocSnapshot } from '@mesaas/report-blocks/types';
import { normalizeCoverColorPatch, stepCoverLogoSize } from './layoutOps';

const KICKER_DEFAULT = 'Relatório mensal · Instagram';
const LOGO_SIZE_DEFAULT = 36;
const COVER_INK_FALLBACK = '#171717';

export interface CoverEditorProps {
  block: ReportBlock;
  snapshot: ReportDocSnapshot;
  onConfigChange: (id: string, patch: Record<string, unknown>) => void;
}

export function CoverEditor({ block, snapshot, onConfigChange }: CoverEditorProps) {
  const b = snapshot.branding;
  const config = (block.config ?? {}) as CoverConfig;
  const kicker = config.kicker ?? KICKER_DEFAULT;
  const title = config.title ?? snapshot.period.label;
  const subtitle =
    config.subtitle ??
    `@${snapshot.account.handle}${snapshot.account.specialty ? ` · ${snapshot.account.specialty}` : ''}`;
  const logoSize = config.logoSize ?? LOGO_SIZE_DEFAULT;
  const clientName = snapshot.account.client_name ?? snapshot.account.handle;
  const accentColor = snapshot.branding.accent_color;

  const colorStyle = config.color
    ? { background: config.color, color: pickAccentFg(config.color, COVER_INK_FALLBACK) }
    : {
        background: 'var(--rb-cover-bg, var(--rb-accent))',
        color: 'var(--rb-cover-fg, var(--rb-accent-fg))',
      };

  const emitColor = (hex: string) => {
    const patch = normalizeCoverColorPatch(hex);
    if (Object.keys(patch).length > 0) onConfigChange(block.id, patch);
  };

  return (
    <div
      className="rb-cover"
      style={{ ...colorStyle, borderRadius: 12, padding: '2.5rem 2rem' } as CSSProperties}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {b.logo_url ? (
          <img
            src={b.logo_url}
            alt=""
            style={{ height: logoSize, borderRadius: 8, background: '#fff', padding: 4 }}
          />
        ) : null}
        <CoverAvatar
          name={clientName}
          photoUrl={snapshot.account.profile_picture_url ?? null}
          size={logoSize}
        />
        <span style={{ fontWeight: 600 }}>{b.workspace_name}</span>
        <div style={{ display: 'flex', gap: '0.25rem', marginLeft: 'auto' }}>
          <button
            type="button"
            className="rb-edit-btn"
            aria-label="Diminuir logo"
            onClick={() =>
              onConfigChange(block.id, { logoSize: stepCoverLogoSize(config.logoSize, -1) })
            }
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rb-edit-btn"
            aria-label="Aumentar logo"
            onClick={() =>
              onConfigChange(block.id, { logoSize: stepCoverLogoSize(config.logoSize, 1) })
            }
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <input
        aria-label="Texto de destaque da capa"
        value={kicker}
        onChange={(e) => onConfigChange(block.id, { kicker: e.target.value || undefined })}
        className="rb-section-input"
        style={{
          marginTop: '2rem',
          fontSize: '0.8rem',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          opacity: 0.85,
          color: 'inherit',
        }}
      />
      <input
        aria-label="Título da capa"
        value={title}
        onChange={(e) => onConfigChange(block.id, { title: e.target.value || undefined })}
        className="rb-section-input"
        style={{
          fontSize: '2rem',
          fontFamily: 'var(--rb-font-display, inherit)',
          letterSpacing: '-1px',
          color: 'inherit',
        }}
      />
      <input
        aria-label="Subtítulo da capa"
        value={subtitle}
        onChange={(e) => onConfigChange(block.id, { subtitle: e.target.value || undefined })}
        className="rb-section-input"
        style={{ opacity: 0.9, color: 'inherit' }}
      />
      {b.splash_url ? (
        <img
          src={b.splash_url}
          alt=""
          className="rb-cover-splash"
          style={{
            marginTop: '1.5rem',
            width: '100%',
            aspectRatio: '21 / 9',
            objectFit: 'cover',
            borderRadius: 8,
          }}
        />
      ) : null}
      <div style={{ marginTop: '1.5rem' }}>
        <ColorPicker
          value={config.color ?? accentColor}
          onChange={emitColor}
          brandColors={[accentColor]}
          allowAlpha={false}
          label="Cor da capa"
        />
        {config.color && (
          <button
            type="button"
            className="rb-appearance-reset"
            onClick={() => onConfigChange(block.id, { color: undefined })}
          >
            usar cor de destaque
          </button>
        )}
      </div>
    </div>
  );
}
