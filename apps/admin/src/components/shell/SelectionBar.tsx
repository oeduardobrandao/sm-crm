import type { ReactNode } from 'react';
import { BottomActionBar } from '@mesaas/ios-kit';
import { useIsPhone } from '../../hooks/useIsPhone';

export interface SelectionBarProps {
  count: number;
  /** Action buttons. */
  children: ReactNode;
  /** Defaults to "{count} selecionado(s)". */
  label?: string;
}

/** Floating action bar for a list in selection mode. Renders nothing at count 0. */
export function SelectionBar({ count, children, label }: SelectionBarProps) {
  const isPhone = useIsPhone();
  if (count === 0) return null;
  const text = label ?? `${count} ${count === 1 ? 'selecionado' : 'selecionados'}`;
  if (isPhone) {
    return (
      <BottomActionBar role="toolbar" aria-label="Ações da seleção" aboveTabBar>
        <span className="mr-auto text-sm font-semibold">{text}</span>
        {children}
      </BottomActionBar>
    );
  }
  return (
    <div
      role="toolbar"
      aria-label="Ações da seleção"
      className="admin-glass fixed bottom-7 left-[calc(50%+136px)] z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card py-2 pl-[18px] pr-2 shadow-lg"
    >
      <span className="mr-1.5 text-sm font-semibold">{text}</span>
      {children}
    </div>
  );
}
