// Desfazer/refazer do layout nos editores de relatório e de modelo. Embrulha o
// applyLayout do autosave: todo write de layout passa por commit(), então
// undo/redo também são salvos como qualquer edição. O título fica de fora (tem
// o próprio input, com o desfazer nativo do navegador).
import { useEffect, useRef, useState } from 'react';
import type { ReportLayout } from '@mesaas/report-blocks/types';

export const HISTORY_LIMIT = 100;
/** Janela deslizante em que edições com a mesma chave viram UMA entrada
 *  (digitação num input de seção/capa ou num bloco de texto). */
export const COALESCE_MS = 1000;

export function useLayoutHistory(layout: ReportLayout, applyLayout: (next: ReportLayout) => void) {
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const past = useRef<ReportLayout[]>([]);
  const future = useRef<ReportLayout[]>([]);
  const lastKey = useRef<string | null>(null);
  const lastAt = useRef(0);
  // Só para re-renderizar os botões quando as pilhas mudam.
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  function commit(next: ReportLayout, coalesceKey?: string) {
    const current = layoutRef.current;
    if (next === current) return;
    const now = Date.now();
    const coalesce =
      coalesceKey !== undefined &&
      coalesceKey === lastKey.current &&
      now - lastAt.current < COALESCE_MS;
    if (!coalesce) {
      past.current.push(current);
      if (past.current.length > HISTORY_LIMIT) past.current.shift();
    }
    future.current = [];
    lastKey.current = coalesceKey ?? null;
    lastAt.current = now;
    // O layoutRef local avança já: dois commits no mesmo tick (antes do
    // re-render) empilham a partir do estado certo.
    layoutRef.current = next;
    applyLayout(next);
    bump();
  }

  function undo() {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(layoutRef.current);
    lastKey.current = null;
    layoutRef.current = prev;
    applyLayout(prev);
    bump();
  }

  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(layoutRef.current);
    lastKey.current = null;
    layoutRef.current = next;
    applyLayout(next);
    bump();
  }

  // Atalhos: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z e Ctrl+Y. Com o foco num campo de
  // texto (input, textarea, bloco TipTap) o atalho fica com o desfazer nativo
  // do campo; os botões do cabeçalho seguem operando no layout.
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      } else if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)) {
        e.preventDefault();
        redoRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return {
    commit,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
