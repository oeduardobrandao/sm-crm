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
      {(
        [
          ['entregas', 'Etapas'],
          ['publicacoes', 'Status'],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          onClick={() => onModeChange(id)}
          style={{
            padding: '0.35rem 0.85rem',
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
