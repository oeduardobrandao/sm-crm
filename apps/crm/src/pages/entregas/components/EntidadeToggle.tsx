import type { EntidadeFilter } from '../viewQuery';

interface EntidadeToggleProps {
  value: EntidadeFilter;
  onChange: (value: EntidadeFilter) => void;
}

const OPTIONS: { id: EntidadeFilter; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'fluxos', label: 'Fluxos' },
  { id: 'posts', label: 'Posts individuais' },
];

/** Filtro de entidade do quadro de Fluxos (spec §4.1), no mesmo desenho de
 *  ModeToggle. */
export function EntidadeToggle({ value, onChange }: EntidadeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Entidades do quadro"
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
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: '0.35rem 0.85rem',
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.8rem',
            background: value === o.id ? 'var(--cta-bg)' : 'transparent',
            color: value === o.id ? 'var(--cta-fg)' : 'var(--text-secondary)',
            fontWeight: value === o.id ? 600 : 400,
            whiteSpace: 'nowrap',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
