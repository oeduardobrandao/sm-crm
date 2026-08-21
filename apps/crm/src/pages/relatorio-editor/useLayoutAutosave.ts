// Autosave do editor de blocos, no padrão inline da casa (WorkflowDrawer:448):
// otimista no estado, saving liga ANTES do debounce, clearTimeout do anterior,
// validateLayout como gate final antes do PostgREST.
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { validateLayout, type ReportLayout } from '@mesaas/report-blocks/types';
import { updateReportDoc } from '../../services/reportDocs';

const LAYOUT_DEBOUNCE_MS = 1500;
const TITLE_DEBOUNCE_MS = 400;
const SAVE_ERROR_MSG = 'Erro ao salvar o relatório';

export function useLayoutAutosave(docId: string, initial: { layout: ReportLayout; title: string }) {
  const [layout, setLayout] = useState<ReportLayout>(initial.layout);
  const [title, setTitleState] = useState(initial.title);
  const [saving, setSaving] = useState(false);

  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleDirty = useRef(false);
  const pendingLayout = useRef<ReportLayout | null>(null);
  const docIdRef = useRef(docId);
  const titleRef = useRef(title);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  docIdRef.current = docId;
  titleRef.current = title;

  useEffect(
    () => () => {
      if (layoutTimer.current) clearTimeout(layoutTimer.current);
      if (titleTimer.current) clearTimeout(titleTimer.current);
      // Best-effort: edição pendente não morre com a navegação. Sem await
      // (cleanup é síncrono); falha aqui é aceita — o gate de validade se mantém.
      // Rotas também através da chain para não correr com um save em voo.
      const pending = pendingLayout.current;
      if (pending) {
        const check = validateLayout(pending);
        if (check.ok) {
          saveChain.current = saveChain.current
            .then(async () => {
              void updateReportDoc(docIdRef.current, { layout: pending }).catch(() => {});
            })
            .catch(() => {});
        }
      }
      if (titleDirty.current) {
        saveChain.current = saveChain.current
          .then(async () => {
            void updateReportDoc(docIdRef.current, { title: titleRef.current }).catch(() => {});
          })
          .catch(() => {});
      }
    },
    [],
  );

  function applyLayout(next: ReportLayout) {
    if (next === layout) return;
    setLayout(next);
    pendingLayout.current = next;
    setSaving(true);
    if (layoutTimer.current) clearTimeout(layoutTimer.current);
    layoutTimer.current = setTimeout(() => {
      layoutTimer.current = null;
      saveChain.current = saveChain.current.then(async () => {
        const toSave = pendingLayout.current;
        pendingLayout.current = null;
        if (!toSave) {
          if (pendingLayout.current === null) setSaving(false);
          return;
        }
        const check = validateLayout(toSave);
        if (!check.ok) {
          // Bug de layoutOps se chegar aqui: nada de request com payload inválido.
          console.error('[relatorio-editor] layout inválido no autosave:', check);
          toast.error(SAVE_ERROR_MSG);
          if (pendingLayout.current === null) setSaving(false);
          return;
        }
        try {
          await updateReportDoc(docIdRef.current, { layout: toSave });
        } catch (err) {
          console.error('[relatorio-editor] autosave falhou:', err);
          toast.error(SAVE_ERROR_MSG);
        } finally {
          if (pendingLayout.current === null) setSaving(false);
        }
      });
    }, LAYOUT_DEBOUNCE_MS);
  }

  function setTitle(next: string) {
    setTitleState(next);
    titleDirty.current = true;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      titleTimer.current = null;
      saveChain.current = saveChain.current.then(async () => {
        if (!titleDirty.current) return;
        titleDirty.current = false;
        const toSave = titleRef.current;
        try {
          await updateReportDoc(docIdRef.current, { title: toSave });
        } catch (err) {
          console.error('[relatorio-editor] save de título falhou:', err);
          toast.error(SAVE_ERROR_MSG);
        }
      });
    }, TITLE_DEBOUNCE_MS);
  }

  return { layout, applyLayout, title, setTitle, saving };
}
