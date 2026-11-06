import type { ReactNode } from 'react';
import { BottomActionBar } from '@mesaas/ios-kit';
import { useIsPhone } from '../../hooks/useIsPhone';

export interface SelectionBarProps {
  count: number;
  /** Action buttons. */
  children: ReactNode;
  /** Defaults to "{count} selecionado(s)". */
  label?: string;
  /** The toolbar's accessible name. */
  ariaLabel?: string;
}

/** Floating action bar for a list in selection mode. Renders nothing at count 0. */
export function SelectionBar({
  count,
  children,
  label,
  ariaLabel = 'Ações da seleção',
}: SelectionBarProps) {
  const isPhone = useIsPhone();
  if (count === 0) return null;
  const text = label ?? `${count} ${count === 1 ? 'selecionado' : 'selecionados'}`;
  if (isPhone) {
    // One row when the count and the actions fit; on a 375-390pt phone the actions wrap to a
    // second row and share it, like the board's full-width pair (admin-kit.css).
    return (
      <BottomActionBar
        role="toolbar"
        aria-label={ariaLabel}
        aboveTabBar
        className="admin-selection-bar"
      >
        <span aria-live="polite" className="min-w-0 truncate pl-2.5 text-sm font-semibold">
          {text}
        </span>
        <div className="flex shrink-0 grow items-center gap-2 [&>*]:flex-1">{children}</div>
      </BottomActionBar>
    );
  }
  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className="admin-glass fixed bottom-7 left-[calc(50%+136px)] z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card py-2 pl-[18px] pr-2 shadow-lg"
    >
      <span aria-live="polite" className="mr-1.5 text-sm font-semibold">
        {text}
      </span>
      {children}
    </div>
  );
}
