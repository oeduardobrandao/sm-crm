import { useTranslation } from 'react-i18next';
import { useVidroShell } from '@/components/layout/PageToolbarContext';

export type EntregasMode = 'entregas' | 'publicacoes';

interface ModeToggleProps {
  mode: EntregasMode;
  onModeChange: (mode: EntregasMode) => void;
}

/** Pill toggle between workflow cards and individual posts, shared by the
 *  Kanban, Calendário and Lista views (each holds its own mode state).
 *
 *  Labelled "Etapas"/"Status" rather than "Fluxos"/"Publicações": the
 *  EntidadeToggle filter next to this one also has a "Fluxos" option, and
 *  the repeated word across two adjacent toggles reads as if they control
 *  the same thing. The *value* stays 'entregas'/'publicacoes' — it is
 *  serialized into the URL and into saved vistas, and renaming it would
 *  silently reset every shared link. */
export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  const { t } = useTranslation('entregas');
  const vidroShell = useVidroShell();
  const options = [
    ['entregas', t('modeToggle.entregas')],
    ['publicacoes', t('modeToggle.publicacoes')],
  ] as const;
  // Under the Vidro shell the toggle takes the skin's segmented-capsule styles
  // (data-slot hooks) and drops its inline styles, which would win over them.
  if (vidroShell) {
    return (
      <div data-slot="toggle-group">
        {options.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            data-slot="toggle-group-item"
            data-state={mode === id ? 'on' : 'off'}
            onClick={() => onModeChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.25rem',
        background: 'var(--card-bg)',
        border: '1px solid var(--border-color)',
        padding: '0.25rem',
        borderRadius: 8,
        width: 'fit-content',
      }}
    >
      {options.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onModeChange(id)}
          style={{
            padding: '0.3rem 0.65rem',
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.8rem',
            background: mode === id ? 'var(--cta-bg)' : 'transparent',
            color: mode === id ? 'var(--cta-fg)' : 'var(--text-secondary)',
            fontWeight: mode === id ? 600 : 400,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
