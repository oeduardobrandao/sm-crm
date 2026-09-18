import { useTranslation } from 'react-i18next';

export type FluxoFilter = 'all' | 'avulso' | `wf-${number}`;

export interface FluxoFilterOption {
  key: FluxoFilter;
  label: string;
  count: number;
}

interface FluxoFilterChipsProps {
  value: FluxoFilter;
  options: FluxoFilterOption[];
  onChange: (value: FluxoFilter) => void;
}

/** Postagens-only fluxo filter; rendered only when there is more than one fluxo (incl. avulsas). */
export function FluxoFilterChips({ value, options, onChange }: FluxoFilterChipsProps) {
  const { t } = useTranslation('hubPosts');
  if (options.length <= 1) return null;
  const all: FluxoFilterOption = {
    key: 'all',
    label: t('postagens.filter.all', 'Todos'),
    count: options.reduce((n, o) => n + o.count, 0),
  };
  return (
    <div
      role="group"
      aria-label={t('postagens.filter.fluxoLabel', 'Filtrar por fluxo')}
      className="flex flex-wrap gap-1.5 mb-3"
    >
      {[all, ...options].map((opt) => {
        const selected = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.key)}
            className="rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors"
            style={
              selected
                ? {
                    background: 'var(--hub-txt)',
                    color: 'var(--hub-card)',
                    borderColor: 'var(--hub-txt)',
                  }
                : { color: 'var(--hub-tx2)', borderColor: 'var(--hub-bd)' }
            }
          >
            {opt.label} ({opt.count})
          </button>
        );
      })}
    </div>
  );
}
