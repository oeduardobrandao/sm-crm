export type EntregasMode = 'entregas' | 'publicacoes';

interface ModeToggleProps {
  mode: EntregasMode;
  onModeChange: (mode: EntregasMode) => void;
}

/** Pill toggle between workflow cards and individual posts, shared by the
 *  Kanban, Calendário and Lista views (each holds its own mode state). */
export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.25rem',
        background: 'var(--surface-2)',
        padding: '0.25rem',
        borderRadius: 8,
        width: 'fit-content',
      }}
    >
      {(
        [
          ['entregas', 'Entregas'],
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
            background: mode === id ? '#000' : 'transparent',
            color: mode === id ? '#fff' : 'var(--text-secondary)',
            fontWeight: mode === id ? 600 : 400,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
