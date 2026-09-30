import type { CSSProperties } from 'react';

/**
 * One pill shape for every Postagens filter control (status chips and the month/media
 * dropdown triggers), so the row reads as a single set of filters.
 */
export const FILTER_PILL_CLASS =
  'inline-flex h-8 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[12px] font-semibold transition-colors';

export function filterPillStyle(selected: boolean): CSSProperties {
  return selected
    ? { background: 'var(--hub-acc)', color: 'var(--hub-acc-fg)', borderColor: 'var(--hub-acc)' }
    : { background: 'var(--hub-card)', color: 'var(--hub-tx2)', borderColor: 'var(--hub-bd)' };
}
