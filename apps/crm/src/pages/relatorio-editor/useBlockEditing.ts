// Interações de bloco compartilhadas pelo editor de relatório e pelo de
// modelo: inserir na posição escolhida, excluir com desfazer, destacar e
// rolar até um bloco.
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { BlockType, ReportLayout } from '@mesaas/report-blocks/types';
import { insertBlockAt, removeBlock, restoreBlock } from './layoutOps';

export function useBlockEditing(
  layoutRef: { current: ReportLayout },
  applyLayout: (next: ReportLayout) => void,
) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Posição de inserção do próximo widget: null = fim do documento. Setada
  // pelos pontos de inserção do painel de camadas antes de abrir o drawer.
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nenhum dos dois timers sobrevive a um unmount: sem isso, um insert seguido
  // de navegação dispara o callback depois que jsdom já derrubou a árvore
  // (scrollIntoView é undefined lá) ou tenta setHighlightId num componente
  // desmontado, vazando pro próximo arquivo de teste que rodar em seguida.
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    },
    [],
  );

  // Exclusão com desfazer: o toast carrega a posição de origem (idx) — sem
  // ela, "Desfazer" reinseriria sempre no fim, perdendo a ordem do usuário.
  function handleRemoveBlock(id: string) {
    const idx = layoutRef.current.blocks.findIndex((b) => b.id === id);
    const block = layoutRef.current.blocks[idx];
    if (!block) return;
    applyLayout(removeBlock(layoutRef.current, id));
    toast('Bloco excluído.', {
      action: {
        label: 'Desfazer',
        onClick: () => applyLayout(restoreBlock(layoutRef.current, block, idx)),
      },
    });
  }

  function highlightAndScroll(id: string) {
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 2500);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      // jsdom não implementa scrollIntoView (undefined no protótipo do
      // elemento) — o `?.()` opcional no MÉTODO, não só no querySelector,
      // evita o TypeError que corrompe o próximo arquivo de teste.
      document
        .querySelector(`[data-block-id="${id}"]`)
        ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  function openWidgetDrawer(at: number | null) {
    setInsertAt(at);
    setDrawerOpen(true);
  }

  function handleInsert(type: BlockType) {
    const { layout: next, newId } = insertBlockAt(
      layoutRef.current,
      type,
      insertAt ?? layoutRef.current.blocks.length,
    );
    applyLayout(next);
    highlightAndScroll(newId);
  }

  return {
    drawerOpen,
    setDrawerOpen,
    highlightId,
    highlightAndScroll,
    openWidgetDrawer,
    handleInsert,
    handleRemoveBlock,
  };
}
