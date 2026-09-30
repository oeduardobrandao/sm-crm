import { useTranslation } from 'react-i18next';
import { FILTER_PILL_CLASS, filterPillStyle } from './filterPill';

export type MediaFilter = 'all' | 'with' | 'without';

export interface MediaFilterCounts {
  all: number;
  withMedia: number;
  withoutMedia: number;
}

interface MediaFilterChipsProps {
  value: MediaFilter;
  counts: MediaFilterCounts;
  onChange: (value: MediaFilter) => void;
  /** Group classes; `contents` lets a parent flex row lay the chips out directly. */
  className?: string;
}

/** Aprovações-only filter: posts that carry media vs text-only (or auto-cleaned) posts. */
export function MediaFilterChips({
  value,
  counts,
  onChange,
  className = 'flex flex-wrap gap-1.5',
}: MediaFilterChipsProps) {
  const { t } = useTranslation('hubPosts');
  const options: { key: MediaFilter; label: string; count: number }[] = [
    { key: 'all', label: t('postagens.filter.all', 'Todos'), count: counts.all },
    { key: 'with', label: t('aprovacoes.mediaFilter.with', 'Com mídia'), count: counts.withMedia },
    {
      key: 'without',
      label: t('aprovacoes.mediaFilter.without', 'Sem mídia'),
      count: counts.withoutMedia,
    },
  ];
  return (
    <div
      role="group"
      aria-label={t('aprovacoes.mediaFilter.label', 'Filtrar por mídia')}
      className={className}
    >
      {options.map((opt) => {
        const selected = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.key)}
            className={FILTER_PILL_CLASS}
            style={filterPillStyle(selected)}
          >
            {opt.label} ({opt.count})
          </button>
        );
      })}
    </div>
  );
}
