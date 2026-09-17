import { useTranslation } from 'react-i18next';
import { getClientStatusLabel } from '../lib/postView';

export type StatusFilter = 'all' | 'enviado_cliente' | 'correcao_cliente' | 'aprovado_cliente';

export const STATUS_FILTERS: readonly StatusFilter[] = [
  'all',
  'enviado_cliente',
  'correcao_cliente',
  'aprovado_cliente',
];

interface StatusFilterChipsProps {
  value: StatusFilter;
  counts: Record<StatusFilter, number>;
  onChange: (value: StatusFilter) => void;
}

/** Postagens-only status filter. Labels reuse the client status labels (spec: "Correção solicitada", never "Rejeitado"). */
export function StatusFilterChips({ value, counts, onChange }: StatusFilterChipsProps) {
  const { t } = useTranslation('hubPosts');
  return (
    <div
      role="group"
      aria-label={t('postagens.filter.label', 'Filtrar por status')}
      className="flex flex-wrap gap-1.5 mb-6"
    >
      {STATUS_FILTERS.map((filter) => {
        const selected = value === filter;
        const label =
          filter === 'all' ? t('postagens.filter.all', 'Todos') : getClientStatusLabel(t, filter);
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(filter)}
            className="rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors"
            style={
              selected
                ? {
                    background: 'var(--hub-acc)',
                    color: 'var(--hub-acc-fg)',
                    borderColor: 'var(--hub-acc)',
                  }
                : { color: 'var(--hub-tx2)', borderColor: 'var(--hub-bd)' }
            }
          >
            {label} ({counts[filter]})
          </button>
        );
      })}
    </div>
  );
}
