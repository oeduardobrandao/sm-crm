import type { CSSProperties } from 'react';

/** Nav counters in Pauta: brand-tinted when idle, inverted on the active pill.
 * Inline because the radius is per-preset and must not meet hub-btn-primary. */
export const PAUTA_BADGE_CLASS =
  'min-w-[18px] h-[18px] px-1 text-[12px] font-bold flex items-center justify-center';

export function pautaBadgeStyle(active: boolean): CSSProperties {
  return active
    ? {
        background: 'var(--hub-primary-fg)',
        color: 'var(--hub-primary)',
        borderRadius: 'var(--hub-r-chip)',
      }
    : {
        background: 'var(--hub-acc-soft)',
        color: 'var(--hub-txt)',
        borderRadius: 'var(--hub-r-chip)',
      };
}
