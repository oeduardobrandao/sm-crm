import type { KeyboardEvent } from 'react';

/** Arrow-key handler shared by roving-focus widgets in this kit. */
export function rovingIndex(
  e: KeyboardEvent,
  index: number,
  count: number,
  orientation: 'horizontal' | 'vertical' | 'both' = 'both',
): number | null {
  const prev =
    (orientation !== 'vertical' && e.key === 'ArrowLeft') ||
    (orientation !== 'horizontal' && e.key === 'ArrowUp');
  const next =
    (orientation !== 'vertical' && e.key === 'ArrowRight') ||
    (orientation !== 'horizontal' && e.key === 'ArrowDown');
  if (prev) return (index - 1 + count) % count;
  if (next) return (index + 1) % count;
  if (e.key === 'Home') return 0;
  if (e.key === 'End') return count - 1;
  return null;
}
