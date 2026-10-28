// Interações de bloco compartilhadas pelo editor de relatório e pelo de
// modelo: inserir na seção e posição escolhidas, excluir com desfazer,
// destacar e rolar até um bloco.
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { BlockType, ReportLayout } from '@mesaas/report-blocks/types';
import { insertBlock, insertBlockInSection, removeBlock, restoreBlock } from './layoutOps';

/** Onde o próximo widget entra: na seção `sectionId` (id do marcador), no
 * índice `position` entre os blocos dela (ausente = fim da seção). */
export interface InsertTarget {
  sectionId: string;
  position?: number;
}

export function useBlockEditing(
  layoutRef: { current: ReportLayout },
  applyLayout: (next: ReportLayout) => void,
) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Alvo do próximo widget, setado pelo ponto de inserção antes de abrir o
  // drawer (que lista só o que a seção aceita). null = fim do relatório: fim
  // da última seção que aceita o tipo (insertBlock).
  const [insertTarget, setInsertTarget] = useState<InsertTarget | null>(null);
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
    const next = removeBlock(layoutRef.current, id);
    // Marcador de seção: removeBlock recusa (só removeSection o tira).
    if (next === layoutRef.current) return;
    applyLayout(next);
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

  function openWidgetDrawer(target: InsertTarget | null) {
    setInsertTarget(target);
    setDrawerOpen(true);
  }

  function handleInsert(type: BlockType) {
    const current = layoutRef.current;
    const newId = crypto.randomUUID();
    const next = insertTarget
      ? insertBlockInSection(
          current,
          insertTarget.sectionId,
          type,
          insertTarget.position,
          () => newId,
        )
      : insertBlock(current, type, () => newId).layout;
    // Mesma referência = a seção não aceita o tipo (ou sumiu): nada a aplicar.
    if (next === current) return;
    applyLayout(next);
    highlightAndScroll(newId);
  }

  return {
    drawerOpen,
    setDrawerOpen,
    highlightId,
    highlightAndScroll,
    insertTarget,
    openWidgetDrawer,
    handleInsert,
    handleRemoveBlock,
  };
}
