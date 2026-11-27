import { useRef, type ReactNode } from 'react';
import { usePanOnSpace } from '@/hooks/usePanOnSpace';
import { useIsPhoneShell } from '@/lib/phoneShell';

/**
 * O `.board-container` dos quadros kanban (Fluxos, Publicações, Tarefas), com Espaço + arrastar
 * para rolar na horizontal. Só no shell de desktop: no shell de celular o quadro rola por toque.
 */
export function BoardScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const isPhoneShell = useIsPhoneShell();
  usePanOnSpace(ref, { enabled: !isPhoneShell });
  return (
    <div ref={ref} className="board-container">
      {children}
    </div>
  );
}
