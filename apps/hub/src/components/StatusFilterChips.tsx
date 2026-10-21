import { useTranslation } from 'react-i18next';
import { getClientStatusLabel } from '../lib/postView';
import { useHubLook } from '../hooks/useHubLook';
import { FILTER_PILL_CLASS, filterPillStyle } from './filterPill';

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
  /**
   * Classes for the group element. Defaults to a standalone wrapping row with its own bottom
   * margin; a parent that lays the chips out in its own flex row passes `contents` so the
   * chips become that row's direct children (the group keeps its ARIA role and label).
   */
  className?: string;
}

/** Postagens-only status filter. Labels reuse the client status labels (spec: "Correção solicitada", never "Rejeitado"). */
export function StatusFilterChips({
  value,
  counts,
  onChange,
  className = 'flex flex-wrap gap-1.5 mb-6',
}: StatusFilterChipsProps) {
  const { t } = useTranslation('hubPosts');
  const look = useHubLook();
  return (
    <div
      role="group"
      aria-label={t('postagens.filter.label', 'Filtrar por status')}
      className={className}
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
            className={FILTER_PILL_CLASS}
            style={filterPillStyle(selected, look)}
          >
            {label} ({counts[filter]})
          </button>
        );
      })}
    </div>
  );
}
