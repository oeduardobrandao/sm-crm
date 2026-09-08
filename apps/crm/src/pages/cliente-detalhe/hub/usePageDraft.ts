import { useCallback, useMemo } from 'react';

const KEY = (id: string) => `hub-page-draft:${id}`;

/**
 * `useBlocker` está proibido no projeto (React Router só honra o último blocker
 * registrado, e registrar um desliga a troca silenciosa entre deploys -- ver
 * silent-update.router.test.ts). A estratégia daqui é não bloquear nada: o
 * rascunho sobrevive a navegar para fora E a fechar a aba, que é mais proteção
 * do que um blocker daria.
 *
 * `pageId` é `null` para uma página nova ainda sem id (a criação em si nunca
 * teve um rascunho local para restaurar) -- todo método vira no-op nesse caso.
 */
export function usePageDraft(pageId: string | null) {
  const draft = useMemo(() => {
    if (!pageId) return null;
    try {
      const raw = localStorage.getItem(KEY(pageId));
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      return null; // aba privativa, cota estourada, JSON corrompido
    }
  }, [pageId]);

  const saveDraft = useCallback(
    (doc: Record<string, unknown>) => {
      if (!pageId) return;
      try {
        localStorage.setItem(KEY(pageId), JSON.stringify(doc));
      } catch {
        /* rascunho é conveniência, nunca pode derrubar a edição */
      }
    },
    [pageId],
  );

  const clearDraft = useCallback(() => {
    if (!pageId) return;
    try {
      localStorage.removeItem(KEY(pageId));
    } catch {
      /* idem */
    }
  }, [pageId]);

  return { draft, saveDraft, clearDraft };
}
