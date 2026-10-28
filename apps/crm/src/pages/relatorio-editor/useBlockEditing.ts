// Interações de bloco e de seção compartilhadas pelo editor de relatório e
// pelo de modelo: inserir na seção e posição escolhidas, excluir com desfazer,
// adicionar e remover seção (com desfazer), destacar e rolar até um bloco ou
// seção.
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  BlockType,
  ReportBlock,
  ReportLayout,
  SectionKind,
} from '@mesaas/report-blocks/types';
import { toSections } from '@mesaas/report-blocks/types';
import { PLATFORM_NAMES } from '@mesaas/report-blocks/platform';
import {
  addSection,
  insertBlock,
  insertBlockInSection,
  removeBlock,
  removeSection,
  restoreBlock,
  restoreSection,
} from './layoutOps';

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
      // Bloco ou frame de seção (id do marcador).
      document
        .querySelector(`[data-block-id="${id}"], .rb-section-frame[data-section-id="${id}"]`)
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
    // Layout vazio sem alvo: a seção Geral entra primeiro, senão o bloco
    // ficaria fora de qualquer seção (layout legado).
    if (!insertTarget && current.blocks.length === 0) {
      const withGeneral = addSection(current, 'general', null);
      const target = toSections(withGeneral)[0]?.marker.id;
      const next = target
        ? insertBlockInSection(withGeneral, target, type, undefined, () => newId)
        : current;
      if (next === withGeneral || next === current) return;
      applyLayout(next);
      highlightAndScroll(newId);
      return;
    }
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

  // Remover seção com desfazer: a seção e o índice são guardados ANTES de
  // removeSection, para o "Desfazer" devolver no mesmo lugar, com os blocos.
  function handleRemoveSection(id: string) {
    const current = layoutRef.current;
    const sections = toSections(current);
    const index = sections.findIndex((s) => s.marker.id === id);
    if (index < 0) return;
    const section = sections[index];
    const next = removeSection(current, id);
    if (next === current) return;
    applyLayout(next);
    toast('Seção removida.', {
      action: {
        label: 'Desfazer',
        onClick: () => {
          const now = layoutRef.current;
          const restored = restoreSection(now, section, index);
          if (restored !== now) {
            applyLayout(restored);
            return;
          }
          // Nada a desfazer em silêncio: diz por quê (o caso comum é a mesma
          // plataforma ter sido adicionada de novo nesse meio tempo).
          const { kind } = section;
          const platformTaken = kind !== 'general' && toSections(now).some((s) => s.kind === kind);
          toast.info(
            kind !== 'general' && platformTaken
              ? `Não deu para desfazer: já existe uma seção do ${PLATFORM_NAMES[kind]}.`
              : 'Não deu para desfazer a remoção da seção.',
          );
        },
      },
    });
  }

  // Nova seção depois de `afterSectionId` (null = depois da última) com os
  // blocos dados (os padrões da plataforma, ou nenhum na Geral).
  function handleAddSection(
    kind: SectionKind,
    afterSectionId: string | null,
    blocks: ReportBlock[],
  ) {
    const current = layoutRef.current;
    const markerId = crypto.randomUUID();
    const next = addSection(current, kind, afterSectionId, blocks, () => markerId);
    if (next === current) {
      toast.error(
        'Não deu para adicionar a seção. O relatório já está no limite de seções ou de widgets.',
      );
      return;
    }
    applyLayout(next);
    highlightAndScroll(markerId);
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
    handleRemoveSection,
    handleAddSection,
  };
}
