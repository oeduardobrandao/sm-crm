import { useTranslation } from 'react-i18next';
import { FilterDropdown } from './FilterDropdown';
import { ALL_MONTHS, NO_MONTH, formatMonthKey } from '../lib/postView';

export interface MonthFilterOption {
  /** `YYYY-MM`, or `none` for posts without a date. */
  key: string;
  count: number;
}

interface MonthFilterDropdownProps {
  /** Selected month key, `none`, or `all` (no filter). */
  value: string;
  /** One entry per month that has a visible post, already ordered (newest first, `none` last). */
  options: MonthFilterOption[];
  onChange: (value: string) => void;
}

/**
 * Postagens-only publish-month filter. Rendered only when there is more than one option to
 * choose between.
 */
export function MonthFilterDropdown({ value, options, onChange }: MonthFilterDropdownProps) {
  const { t, i18n } = useTranslation('hubPosts');
  if (options.length <= 1) return null;

  const lang = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const groupLabel = t('postagens.monthFilter.label', 'Filtrar por mês');
  const allLabel = t('postagens.monthFilter.all', 'Todos os meses');
  const labelOf = (key: string) =>
    key === NO_MONTH ? t('postagens.monthFilter.none', 'Sem data') : formatMonthKey(key, lang);

  // A value with no matching option (the page prunes it in an effect) reads as "all".
  const selectedOption = options.find((o) => o.key === value);
  const active = selectedOption !== undefined;
  const triggerLabel = selectedOption
    ? labelOf(selectedOption.key)
    : t('postagens.monthFilter.trigger', 'Todos os meses');

  const items = [
    { key: ALL_MONTHS, label: allLabel, count: null as number | null },
    ...options.map((o) => ({ key: o.key, label: labelOf(o.key), count: o.count })),
  ];
  const currentIndex = Math.max(
    0,
    items.findIndex((i) => i.key === (active ? value : ALL_MONTHS)),
  );

  return (
    <FilterDropdown
      groupLabel={groupLabel}
      triggerLabel={triggerLabel}
      active={active}
      items={items}
      currentIndex={currentIndex}
      onChange={onChange}
    />
  );
}
