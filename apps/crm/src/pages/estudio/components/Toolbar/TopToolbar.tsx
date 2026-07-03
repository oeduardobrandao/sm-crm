// TopToolbar (docs/estudio-design.md §6.1): save pill + undo/redo + zoom control, above the
// ContextualToolbar. "Gerar arte" (AI) is slice 3 — deliberately absent. The save pill renders
// the autosave protocol's four states (§6.2 `saved | saving | dirty | conflict`); the conflict
// BANNER (with the Recarregar action) is EstudioPage's, not this bar's — the pill only mirrors
// the state so it never disappears while the user scrolls.
import { useTranslation } from 'react-i18next';
import type { AutosaveStatus } from '../../hooks/useAutosave';

export interface TopToolbarProps {
  title: string;
  summary: string;
  saveStatus: AutosaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Zoom percentage (1 = 100%). Absent until the canvas transform mounts. */
  zoom?: number;
  onZoomReset?: () => void;
}

const PILL_COLORS: Record<AutosaveStatus, { bg: string; fg: string }> = {
  saved: { bg: 'rgba(62, 207, 142, 0.12)', fg: '#3ecf8e' },
  saving: { bg: 'rgba(66, 200, 245, 0.12)', fg: '#42c8f5' },
  dirty: { bg: 'rgba(245, 163, 66, 0.12)', fg: '#f5a342' },
  conflict: { bg: 'rgba(245, 90, 66, 0.15)', fg: '#f55a42' },
};

const iconButtonStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: '1px solid var(--border-color)',
  background: 'var(--surface-main)',
  color: 'var(--text-main)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  fontSize: '0.9rem',
};

export function TopToolbar({
  title,
  summary,
  saveStatus,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoomReset,
}: TopToolbarProps) {
  const { t } = useTranslation('estudio');
  const pill = PILL_COLORS[saveStatus];

  return (
    <div
      data-testid="estudio-top-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.5rem clamp(1.25rem, 3vw, 2.5rem)',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0,
      }}
    >
      <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 900 }}>{title}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{summary}</span>

      <span
        data-testid="estudio-save-pill"
        data-status={saveStatus}
        role="status"
        style={{
          marginLeft: 'auto',
          padding: '0.2rem 0.6rem',
          borderRadius: 999,
          fontSize: '0.7rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          background: pill.bg,
          color: pill.fg,
        }}
      >
        {t(`editor.savePill.${saveStatus}`)}
      </span>

      <button
        type="button"
        aria-label={t('editor.undo')}
        title={t('editor.undo')}
        disabled={!canUndo}
        onClick={onUndo}
        style={{ ...iconButtonStyle, opacity: canUndo ? 1 : 0.4 }}
      >
        ↩
      </button>
      <button
        type="button"
        aria-label={t('editor.redo')}
        title={t('editor.redo')}
        disabled={!canRedo}
        onClick={onRedo}
        style={{ ...iconButtonStyle, opacity: canRedo ? 1 : 0.4 }}
      >
        ↪
      </button>

      {zoom !== undefined && (
        <button
          type="button"
          aria-label={t('editor.zoomReset')}
          title={t('editor.zoomReset')}
          onClick={onZoomReset}
          style={{
            ...iconButtonStyle,
            width: 'auto',
            padding: '0 0.6rem',
            fontVariantNumeric: 'tabular-nums',
            fontSize: '0.75rem',
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
      )}
    </div>
  );
}
