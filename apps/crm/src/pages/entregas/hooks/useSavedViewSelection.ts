import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { EntregasSavedView } from '@/store/savedViews';
import { useSavedViews } from './useSavedViews';

/**
 * Which saved vista is applied, plus the vista commands with their toasts. Shared
 * by the desktop tab row (VistasTabs) and the phone title menu, so both keep the
 * same rules: the shared-URL match runs once when the list first arrives, a vista
 * is "modified" when the screen no longer matches its query, saving or renaming
 * onto an existing name replaces it.
 */
export function useSavedViewSelection(contaId: string, currentQuery: string) {
  const { views, isLoading, isError, save, updateQuery, rename, remove } = useSavedViews(contaId);
  // The vista the user last applied (or that the shared URL matched on load).
  const [activeId, setActiveId] = useState<string | null>(null);
  // The shared-URL match runs once, when the list first arrives (it used to run
  // at mount, when the list was read synchronously from localStorage). A click
  // on a tab before that also counts, so a late list never overrides the user.
  const matchedRef = useRef(false);

  useEffect(() => {
    if (matchedRef.current || isLoading) return;
    matchedRef.current = true;
    const match = views.find((v) => v.query === currentQuery);
    if (match) setActiveId(match.id);
  }, [isLoading, views, currentQuery]);

  useEffect(() => {
    if (isError) toast.error('Não foi possível carregar as visualizações salvas.');
  }, [isError]);

  const activeVista = activeId != null ? views.find((v) => v.id === activeId) : undefined;
  // The applied vista no longer matches the screen: the user tweaked something.
  const modified = activeVista != null && activeVista.query !== currentQuery;

  const choose = (id: string | null) => {
    matchedRef.current = true;
    setActiveId(id);
  };

  /** Resolves true once saved (the caller clears its name field). */
  const saveNew = async (name: string): Promise<boolean> => {
    const trimmed = name.trim();
    if (!trimmed || isLoading) return false;
    try {
      const row = await save({ name: trimmed, query: currentQuery });
      choose(row.id);
      toast.success(`Visualização "${trimmed}" salva!`);
      return true;
    } catch {
      toast.error('Não foi possível salvar a visualização. Tente novamente.');
      return false;
    }
  };

  const updateWithCurrent = async (v: EntregasSavedView) => {
    choose(v.id);
    try {
      await updateQuery({ id: v.id, query: currentQuery });
      toast.success(`Visualização "${v.name}" atualizada!`);
    } catch {
      toast.error('Não foi possível atualizar a visualização. Tente novamente.');
    }
  };

  const removeVista = async (v: EntregasSavedView) => {
    if (activeId === v.id) setActiveId(null);
    try {
      await remove(v.id);
    } catch {
      toast.error('Não foi possível excluir a visualização. Tente novamente.');
    }
  };

  const renameVista = async (fromId: string, nextName: string) => {
    const from = views.find((v) => v.id === fromId);
    const to = nextName.trim();
    if (!from || !to || to === from.name) return;
    // Renaming onto an existing name replaces that vista (same semantics as
    // saveNew); the unique name per user + workspace would reject a duplicate.
    const replaced = views.find((v) => v.name === to && v.id !== from.id);
    if (replaced && activeId === replaced.id) setActiveId(from.id);
    try {
      await rename({ id: from.id, name: to, replaceId: replaced?.id ?? null });
    } catch {
      toast.error('Não foi possível renomear a visualização. Tente novamente.');
    }
  };

  return {
    views,
    isLoading,
    activeId,
    activeVista,
    modified,
    choose,
    saveNew,
    updateWithCurrent,
    removeVista,
    renameVista,
  };
}
