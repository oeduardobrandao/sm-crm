export type EntregasMode = 'entregas' | 'publicacoes';

interface ModeToggleProps {
  mode: EntregasMode;
  onModeChange: (mode: EntregasMode) => void;
}

/** Pill toggle between workflow cards and individual posts, shared by the
 *  Kanban, Calendário and Lista views (each holds its own mode state).
 *
 *  The 'entregas' mode is labelled "Fluxos": the page is already called
 *  Entregas, so the old label read as "Entregas › Entregas" and gave the
 *  workflow object no name of its own. The *value* stays 'entregas' — it is
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
          ['entregas', 'Fluxos'],
          ['publicacoes', 'Publicações'],
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
