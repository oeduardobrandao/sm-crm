import { useTranslation } from 'react-i18next';
import { FilterDropdown } from './FilterDropdown';

import type { MediaFilter } from './MediaFilterChips';

export type { MediaFilter };

interface MediaFilterDropdownProps {
  value: MediaFilter;
  /** Posts per bucket under the other active filters. */
  counts: Record<'with' | 'without', number>;
  onChange: (value: MediaFilter) => void;
}

/** Postagens-only filter between posts with media (image/video) and text-only posts. */
export function MediaFilterDropdown({ value, counts, onChange }: MediaFilterDropdownProps) {
  const { t } = useTranslation('hubPosts');
  const labels: Record<MediaFilter, string> = {
    all: t('postagens.mediaFilter.all', 'Com e sem mídia'),
    with: t('postagens.mediaFilter.with', 'Com mídia'),
    without: t('postagens.mediaFilter.without', 'Sem mídia'),
  };
  const items = [
    { key: 'all', label: labels.all, count: null },
    { key: 'with', label: labels.with, count: counts.with },
    { key: 'without', label: labels.without, count: counts.without },
  ];
  return (
    <FilterDropdown
      groupLabel={t('postagens.mediaFilter.label', 'Filtrar por mídia')}
      triggerLabel={labels[value]}
      active={value !== 'all'}
      items={items}
      currentIndex={Math.max(
        0,
        items.findIndex((i) => i.key === value),
      )}
      onChange={(key) => onChange(key as MediaFilter)}
    />
  );
}
